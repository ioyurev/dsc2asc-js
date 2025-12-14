import fs from 'fs';
import path from 'path';

// Читаем package.json для получения имени и версии
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const fileName = `${packageJson.name}-v${packageJson.version}.html`;

// Путь к исходному файлу (обычно это index.html в dist-single)
const sourcePath = path.join('dist-single', 'index.html');
const targetPath = path.join('dist-single', fileName);

// Переименовываем файл
if (fs.existsSync(sourcePath)) {
  fs.renameSync(sourcePath, targetPath);
  console.log(`Файл переименован: ${fileName}`);
} else {
  console.log('Файл index.html не найден в dist-single');
}
