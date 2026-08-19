const { app, BrowserWindow } = require('electron')
const path = require('path')

// Headless-friendly flags so it doesn't hang on GPU/compositor.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('headless', 'new')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')

function done(code) { try { app.quit() } catch {} setTimeout(() => process.exit(code), 200) }

const HARD = setTimeout(() => { console.log('TIMEOUT'); done(1) }, 30000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  const file = path.resolve(__dirname, '..', 'renderer', 'index.html')
  await win.loadFile(file)
  await win.webContents.executeJavaScript(`(function(){var d=document.getElementById('dashboard');if(d)d.classList.add('active');})()`)
  await new Promise(r => setTimeout(r, 500))

  const data = await win.webContents.executeJavaScript(`(function(){
    function rect(el){var r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};}
    var body=document.querySelector('.dash-body');
    var left=document.querySelector('.col-left');
    var right=document.querySelector('.col-right');
    var cards=[].slice.call(document.querySelectorAll('.dash-body .card')).map(function(c){return {title:((c.querySelector('.card-title')||{}).textContent||'?'),r:rect(c)};});
    var out={dashBody:body?rect(body):null,colLeft:left?rect(left):null,colRight:right?rect(right):null,cards:cards,overlaps:[]};
    for(var i=0;i<cards.length;i++)for(var j=i+1;j<cards.length;j++){var a=cards[i].r,b=cards[j].r;if(a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom)out.overlaps.push(cards[i].title+' <> '+cards[j].title);}
    return out;
  })()`)
  console.log(JSON.stringify(data, null, 2))
  clearTimeout(HARD)
  done(0)
}).catch(e => { console.log('ERR', e && e.stack || e); done(1) })
