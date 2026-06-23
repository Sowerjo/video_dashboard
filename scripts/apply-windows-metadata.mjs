import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rcedit } from 'rcedit';

const [executableArg, iconArg] = process.argv.slice(2);
if (!executableArg || !iconArg) {
  throw new Error('Uso: node scripts/apply-windows-metadata.mjs <executavel> <icone>');
}

const projectRoot = process.cwd();
const executablePath = path.resolve(projectRoot, executableArg);
const iconPath = path.resolve(projectRoot, iconArg);
const packageData = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const version = String(packageData.version || '1.0.0');
const productName = String(packageData.build?.productName || 'Mind Flix');
const description = String(packageData.description || productName);
const copyright = String(packageData.build?.copyright || `Copyright © ${new Date().getFullYear()} ${productName}`);

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mind-flix-metadata-'));
const temporaryExecutable = path.join(temporaryDirectory, 'MindFlix.exe');
const temporaryIcon = path.join(temporaryDirectory, 'icon.ico');

try {
  await fs.copyFile(executablePath, temporaryExecutable);
  await fs.copyFile(iconPath, temporaryIcon);
  await rcedit(temporaryExecutable, {
    icon: temporaryIcon,
    'file-version': version,
    'product-version': version,
    'requested-execution-level': 'asInvoker',
    'version-string': {
      CompanyName: productName,
      FileDescription: description,
      InternalName: productName,
      LegalCopyright: copyright,
      OriginalFilename: `${productName}.exe`,
      ProductName: productName,
    },
  });
  await fs.copyFile(temporaryExecutable, executablePath);
  console.log(`Metadados aplicados em ${path.basename(executablePath)}.`);
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
