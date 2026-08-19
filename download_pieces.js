const fs = require('fs');
const path = require('path');
const https = require('https');

const dir = path.join(__dirname, 'images', 'pieces');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const pieces = ['p', 'r', 'n', 'b', 'q', 'k'];
const colors = ['w', 'b'];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  for (const color of colors) {
    for (const piece of pieces) {
      const name = `${color}${piece}`;
      const url = `https://images.chesscomfiles.com/chess-themes/pieces/neo/150/${name}.png`;
      const dest = path.join(dir, `${name}.png`);
      console.log(`Downloading ${url}...`);
      try {
        await download(url, dest);
      } catch (err) {
        console.error(`Error downloading ${name}:`, err.message);
      }
    }
  }
  console.log('All downloads finished!');
}

run();
