process.chdir(__dirname);
require('child_process').execSync('npx vite --port 5173', {stdio:'inherit', cwd:__dirname});
