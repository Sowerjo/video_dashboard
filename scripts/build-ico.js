const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

(async () => {
  try {
    const srcPng = path.resolve(__dirname, '..', 'assets', 'ico.png');
    if (!fs.existsSync(srcPng)) {
      console.error('PNG de origem não encontrado:', srcPng);
      process.exit(1);
    }

    // 1) Ícone do app (com 256) — para o executável
    const outIcoRoot = path.resolve(__dirname, '..', 'icon.ico');
    const outIcoAssets = path.resolve(__dirname, '..', 'assets', 'icon.ico');
    const icoAppBuf = await pngToIco([srcPng]);
    fs.writeFileSync(outIcoRoot, icoAppBuf);
    fs.writeFileSync(outIcoAssets, icoAppBuf);

    // 2) Ícones do instalador (NSIS) — somente 16/32/48 para evitar PNG-compressed 256
    const sizes = [16, 32, 48];
    const resizedPngBuffers = [];
    for (const size of sizes) {
      const buf = await sharp(srcPng).resize(size, size, { fit: 'contain' }).png().toBuffer();
      resizedPngBuffers.push(buf);
    }
    const installerIco = await pngToIco(resizedPngBuffers);
    const outInstaller = path.resolve(__dirname, '..', 'assets', 'installer.ico');
    const outUninstaller = path.resolve(__dirname, '..', 'assets', 'uninstaller.ico');
    fs.writeFileSync(outInstaller, installerIco);
    fs.writeFileSync(outUninstaller, installerIco);

    console.log('ICO gerados com sucesso:');
    console.log(' - App icon:', outIcoRoot, 'e', outIcoAssets);
    console.log(' - NSIS icons:', outInstaller, 'e', outUninstaller);
  } catch (e) {
    console.error('Falha ao gerar ICO:', e);
    process.exit(1);
  }
})();