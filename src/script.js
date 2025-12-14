import Chart from 'chart.js/auto';
import JSZip from 'jszip';

// Конфигурация и Словари
const CONFIG = {
    FLOAT32_SIZE: 4,
    X_PRECISION: 4, // Чуть выше точность для науки
    Y_PRECISION: 1,
    FORMATS: {
        asc: { ext: '.asc', delimiter: ' ', decimal: '.', type: 'text/plain' },
        csv_std: { ext: '.csv', delimiter: ',', decimal: '.', type: 'text/csv' },
        csv_ru: { ext: '.csv', delimiter: ';', decimal: ',', type: 'text/csv' }
    },
    // Ключи для сохранения настроек в браузере
    STORAGE_KEYS: {
        FORMAT: 'dsc2asc_pref_format',
        ENCODING: 'dsc2asc_pref_encoding'
    }
};

const DICTIONARY = {
    general: {
        'method': { label: 'Метод съемки', values: { '1': '2Θ-Θ', '2': '2Θ', '3': 'Θ' } },
        'l1': { label: 'Kα1 (Å)' },
        'l2': { label: 'Kα2 (Å)' },
        'lm': { label: 'Lambda Avg (Å)' },
        'beta': { label: 'Kβ (Å)' },
        'r': { label: 'Kα2/Kα1' },
    },
    goniometer: {
        'monotype': { label: 'Монохроматор' },
        'sampthick': { label: 'Толщина (мм)' },
        'tubeang': { label: 'Угол трубки' }
    }
};

// --- Logic ---

class DSCParser {
    constructor(text) {
        this.data = { comment: [], general: {}, goniometer: {}, intervals: [] };
        this.parse(text);
    }

    parse(text) {
        const lines = text.split(/\r?\n/);
        let section = null;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            if (line.startsWith('[') && line.endsWith(']')) {
                section = line.slice(1, -1).toLowerCase();
                continue;
            }
            if (!section) continue;

            if (section === 'intervals') {
                this.parseInterval(line);
            } else if (section === 'comment') {
                this.data.comment.push(line);
            } else if (section === 'general' || section === 'goniometer') {
                const [k, v] = line.split('=');
                if (v) this.data[section][k.trim().toLowerCase()] = v.trim();
            }
        }
    }

    parseInterval(line) {
        const p = line.split(';').map(s => s.trim());
        if (p.length >= 10) {
            this.data.intervals.push({
                start2Th: parseFloat(p[0]),
                end2Th: parseFloat(p[1]),
                step2Th: parseFloat(p[2]),
                status: parseInt(p[8]),
                ext: p[9].toLowerCase(),
            });
        }
    }

    isValid() { return this.data.intervals.length > 0; }
}

class App {
    constructor() {
        this.filesMap = new Map();
        this.dscData = null;
        this.currentDscName = null;
        this.chart = null;
        
        this.initUI();
        this.initChart();
        this.initModal();
    }

    initUI() {
        const dropArea = document.getElementById('dropArea');
        const fileInput = document.getElementById('fileInput');
        const formatSelect = document.getElementById('formatSelect');
        const encodingSelect = document.getElementById('encodingSelect');

        // 1. Восстановление сохраненных настроек
        const savedFormat = localStorage.getItem(CONFIG.STORAGE_KEYS.FORMAT);
        if (savedFormat && CONFIG.FORMATS[savedFormat]) {
            formatSelect.value = savedFormat;
        }

        const savedEncoding = localStorage.getItem(CONFIG.STORAGE_KEYS.ENCODING);
        if (savedEncoding) {
            encodingSelect.value = savedEncoding;
        }

        // 2. Слушатели событий
        dropArea.addEventListener('click', () => fileInput.click());
        dropArea.addEventListener('keydown', e => { if(e.key==='Enter') fileInput.click(); });
        
        ['dragenter','dragover'].forEach(e => dropArea.addEventListener(e, ev => {
            ev.preventDefault(); dropArea.classList.add('drag-over');
        }));
        ['dragleave','drop'].forEach(e => dropArea.addEventListener(e, ev => {
            ev.preventDefault(); dropArea.classList.remove('drag-over');
        }));

        dropArea.addEventListener('drop', e => this.handleFiles(e.dataTransfer.files));
        fileInput.addEventListener('change', e => this.handleFiles(e.target.files));

        document.getElementById('convertBtn').addEventListener('click', () => this.convert());
        
        // Слушатель смены интервала для графика
        document.getElementById('intervalSelect').addEventListener('change', (e) => {
            const idx = parseInt(e.target.value);
            this.updateChartData(idx);
        });

        // Сохранение кодировки при изменении
        encodingSelect.addEventListener('change', (e) => {
            localStorage.setItem(CONFIG.STORAGE_KEYS.ENCODING, e.target.value);
            if (this.currentDscName && this.filesMap.has(this.currentDscName)) {
                this.processDsc(this.filesMap.get(this.currentDscName));
            }
        });

        // Сохранение формата при изменении
        formatSelect.addEventListener('change', (e) => {
            localStorage.setItem(CONFIG.STORAGE_KEYS.FORMAT, e.target.value);
        });
    }

    initModal() {
        const modal = document.getElementById('aboutModal');
        const openBtn = document.getElementById('aboutBtn');
        const closeBtn = document.getElementById('closeModal');

        openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
        closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        
        // Закрытие по клику на фон
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        // Закрытие по Esc
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
            }
        });
    }

    initChart() {
        const ctx = document.getElementById('spectrumChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // Отключаем для производительности
                elements: { point: { radius: 0 } }, // Без точек, только линия
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false } // ОТКЛЮЧЕНЫ ПОДСКАЗКИ
                },
                scales: {
                    x: { 
                        type: 'linear', 
                        title: { display: true, text: '2Theta (deg)' },
                        ticks: { maxRotation: 0 }
                    },
                    y: { 
                        title: { display: true, text: 'Intensity' } 
                    }
                }
            }
        });
    }

    async handleFiles(files) {
        if (!files.length) return;
        const fileArr = Array.from(files);
        
        // Поиск DSC
        const dscFile = fileArr.find(f => f.name.toLowerCase().endsWith('.dsc'));

        if (dscFile) {
            // Очистка при новом DSC (Fix 6)
            this.filesMap.clear();
            this.currentDscName = dscFile.name.toLowerCase();
            this.resetState();
        }

        // Добавляем все файлы
        fileArr.forEach(f => this.filesMap.set(f.name.toLowerCase(), f));

        // Если есть DSC, процессим его
        if (this.currentDscName && this.filesMap.has(this.currentDscName)) {
            await this.processDsc(this.filesMap.get(this.currentDscName));
        }
        
        this.checkDataFiles();
    }

    resetState() {
        this.dscData = null;
        document.getElementById('metaInfo').innerHTML = '<div class="placeholder-text">Обработка...</div>';
        document.getElementById('intervalSelect').innerHTML = '<option>Нет данных</option>';
        document.getElementById('intervalSelect').disabled = true;
        this.chart.data.datasets = [];
        this.chart.update();
        this.updateStatus('dsc', false);
        this.updateStatus('data', false);
    }

    async processDsc(file) {
        try {
            const encoding = document.getElementById('encodingSelect').value;
            const text = await this.readFileText(file, encoding);
            const parser = new DSCParser(text);
            
            if (!parser.isValid()) throw new Error('No intervals found');
            
            this.dscData = parser;
            this.renderMeta(parser.data);
            this.updateStatus('dsc', true);
            this.fillIntervalSelect();
        } catch (e) {
            console.error(e);
            alert('Ошибка чтения DSC: ' + e.message);
            this.updateStatus('dsc', false, true);
        }
    }

    checkDataFiles() {
        if (!this.dscData) return;
        
        const base = this.currentDscName.substring(0, this.currentDscName.lastIndexOf('.'));
        let found = 0;
        let needed = 0;

        this.dscData.data.intervals.forEach(inv => {
            if (inv.status === 0) return;
            needed++;
            const fname = `${base}.${inv.ext}`;
            if (this.filesMap.has(fname)) found++;
        });

        this.updateStatus('data', found > 0);
        
        const btn = document.getElementById('convertBtn');
        btn.disabled = !(found > 0);
        btn.innerText = found > 0 ? `Конвертировать (${found})` : 'Конвертировать';

        // Обновим график первым найденным интервалом, если он еще пуст
        const sel = document.getElementById('intervalSelect');
        if (!sel.disabled && this.chart.data.datasets.length === 0) {
             this.updateChartData(parseInt(sel.value));
        }
    }

    renderMeta(data) {
        const container = document.getElementById('metaInfo');
        container.innerHTML = '';
        
        const createCard = (label, val) => {
            const div = document.createElement('div');
            div.className = 'meta-item';
            div.innerHTML = `<span class="meta-label">${label}</span><span class="meta-value">${val}</span>`;
            return div;
        };

        // General Info
        Object.entries(data.general).forEach(([k, v]) => {
            if (DICTIONARY.general[k]) {
                const def = DICTIONARY.general[k];
                const val = def.values ? (def.values[v] || v) : v;
                container.appendChild(createCard(def.label, val));
            }
        });

        // Goniometer
        Object.entries(data.goniometer).forEach(([k, v]) => {
            if (DICTIONARY.goniometer[k]) {
                container.appendChild(createCard(DICTIONARY.goniometer[k].label, v));
            }
        });

        container.appendChild(createCard('Всего интервалов', data.intervals.length));
    }

    fillIntervalSelect() {
        const sel = document.getElementById('intervalSelect');
        sel.innerHTML = '';
        const base = this.currentDscName.substring(0, this.currentDscName.lastIndexOf('.'));

        this.dscData.data.intervals.forEach((inv, idx) => {
            if (inv.status === 0) return;
            const fname = `${base}.${inv.ext}`;
            const exists = this.filesMap.has(fname);
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${idx+1}: ${inv.start2Th}° - ${inv.end2Th}° [${exists ? 'OK' : 'Нет файла'}]`;
            if (!exists) opt.disabled = true;
            sel.appendChild(opt);
        });
        
        sel.disabled = false;
    }

    async updateChartData(idx) {
        if (!this.dscData) return;
        const interval = this.dscData.data.intervals[idx];
        if (!interval) return;

        const base = this.currentDscName.substring(0, this.currentDscName.lastIndexOf('.'));
        const fname = `${base}.${interval.ext}`;
        const file = this.filesMap.get(fname);

        if (!file) return;

        try {
            const buf = await this.readFileBuf(file);
            const yData = this.parseFloats(buf);
            
            const xData = [];
            for(let i=0; i<yData.length; i++) {
                xData.push(interval.start2Th + (i * interval.step2Th));
            }

            // Оптимизация для графика: если точек очень много, прореживаем для UI (не для экспорта)
            const displayX = [];
            const displayY = [];
            const step = Math.ceil(xData.length / 5000); 
            for(let i=0; i<xData.length; i+=step) {
                displayX.push(xData[i]);
                displayY.push(yData[i]);
            }

            this.chart.data = {
                labels: displayX,
                datasets: [{
                    label: 'Intensity',
                    data: displayY,
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    fill: false
                }]
            };
            this.chart.update();

        } catch (e) {
            console.error('Chart error', e);
        }
    }

    async convert() {
        if (!this.dscData) return;
        
        const msg = document.getElementById('processInfo');
        msg.textContent = 'Генерация...';
        
        const zip = new JSZip();
        const base = this.currentDscName.substring(0, this.currentDscName.lastIndexOf('.'));
        const settings = CONFIG.FORMATS[document.getElementById('formatSelect').value];
        const decimal = settings.decimal;
        const delimiter = settings.delimiter;

        let count = 0;
        let singleContent = null;
        let singleName = null;

        for (const interval of this.dscData.data.intervals) {
            if (interval.status === 0) continue;

            const fname = `${base}.${interval.ext}`;
            const file = this.filesMap.get(fname);
            if (!file) continue;

            const buf = await this.readFileBuf(file);
            const yData = this.parseFloats(buf);
            
            let output = '';
            for(let i=0; i<yData.length; i++) {
                const x = (interval.start2Th + (i * interval.step2Th)).toFixed(CONFIG.X_PRECISION);
                const y = yData[i].toFixed(CONFIG.Y_PRECISION);
                
                const xStr = decimal === '.' ? x : x.replace('.', decimal);
                const yStr = decimal === '.' ? y : y.replace('.', decimal);
                
                output += `${xStr}${delimiter}${yStr}\n`;
            }

            const outName = `${base}_${interval.ext}${settings.ext}`;
            zip.file(outName, output);
            
            singleContent = output;
            singleName = outName;
            count++;
        }

        msg.textContent = `Готово: ${count}`;

        if (count === 1) {
            this.download(singleContent, singleName, settings.type);
        } else if (count > 1) {
            const blob = await zip.generateAsync({type:"blob"});
            this.downloadBlob(blob, `${base}_converted.zip`);
        }
    }

    // Utils
    parseFloats(buf) {
        const cnt = buf.byteLength / 4;
        const arr = new Float32Array(cnt);
        const view = new DataView(buf);
        for(let i=0; i<cnt; i++) arr[i] = view.getFloat32(i*4, true);
        return arr;
    }

    readFileText(file, enc) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = e => res(e.target.result);
            r.onerror = rej;
            r.readAsText(file, enc);
        });
    }

    readFileBuf(file) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = e => res(e.target.result);
            r.onerror = rej;
            r.readAsArrayBuffer(file);
        });
    }

    download(content, name, mime) {
        const blob = new Blob([content], {type: `${mime};charset=utf-8`});
        this.downloadBlob(blob, name);
    }

    downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
        document.body.removeChild(a);
    }

    updateStatus(type, active, error=false) {
        const el = document.getElementById(`${type}Status`);
        el.className = `status-item ${active ? 'active' : ''} ${error ? 'error' : ''}`;
    }
}

document.addEventListener('DOMContentLoaded', () => new App());