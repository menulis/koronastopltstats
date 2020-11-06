const http = require('http')
const request = require('request')
const fetch = require('node-fetch')
const express = require('express')
const path = require('path')
const app = express()
const unzipper = require('unzipper')
const protobuf = require('protobufjs')
 
app.use(express.json())
app.use(express.static('express'))
app.use(express.static('.'))
app.use('/data', async function(req, res) {
    protobuf.load("gaen.proto", async function (err, root) {
      var counters = {}
      try {
        var TemporaryExposureKeyExport = root.lookupType("TemporaryExposureKeyExport")
        var dateResp = await fetch('https://download.cwa.kryptis.lt/version/v1/diagnosis-keys/country/LT/date')
        var dates = await dateResp.json()

        for (const date of dates) {
          var keys = await getFile(`https://download.cwa.kryptis.lt/version/v1/diagnosis-keys/country/LT/date/${date}`, 'export.bin')
          var keyExport = TemporaryExposureKeyExport.decode(keys)
          counters[date] = keyExport["keys"].length
        }
      } catch (e) {
        console.log(e)
      }

      res.send(counters)

    })
  }
)

const server = http.createServer(app)
const port = process.env.PORT || 3000
server.listen(port)
console.debug('Server listening on port ' + port)

async function getFile(url, fileName) {
  const directory = await unzipper.Open.url(request, url)
  const file = directory.files.find(d => d.path === fileName)
  const content = await file.buffer()
  return content.slice(16)
}

