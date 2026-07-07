const http = require('http'), fs = require('fs'), path = require('path')
const dir = path.join(__dirname, 'dist')
http.createServer((req, res) => {
  let f = req.url === '/' ? '/latest.yml' : req.url
  try {
    const d = fs.readFileSync(path.join(dir, f))
    res.writeHead(200, { 'Content-Type': {'.yml':'text/yaml','.exe':'application/octet-stream','.blockmap':'application/json'}[path.extname(f)] || 'application/octet-stream' })
    res.end(d)
  } catch(e) { res.writeHead(404); res.end('') }
}).listen(8888)
