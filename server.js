const http = require('http')
const express = require('express')
const app = express()
const unzipper = require('unzipper')
const protobuf = require('protobufjs')
const { Client, Pool } = require('undici')
const getStream = require('get-stream')

const urls = {
  'LT': 'https://download.koronastop.lt',
  'DE': 'https://svc90.main.px.t-online.de'
}
 
app.use(express.json())
app.use(express.static('.'))
app.get('/data/:countryCode/:type', async function(req, res) {
    protobuf.load("gaen.proto", async function (err, root) {
      const cc = req.params.countryCode
      const type = req.params.type
      const url = urls[cc]
      const client = new Client(url, { pipelining: 10 } )
      try {
        const TemporaryExposureKeyExport = root.lookupType("TemporaryExposureKeyExport")
        const { statusCode, headers, body } = await client.request({
          path: `/version/v1/diagnosis-keys/country/${cc}/date`,
          method: 'GET'
        })

        if (statusCode != 200) {
          throw new Error(statusCode)
        }

        const dates = JSON.parse(await getStream(body))
        const dailyFiles = dates.map(date => `/version/v1/diagnosis-keys/country/${cc}/date/${date}`)

        const hourlyFiles = [].concat.apply([], await Promise.all(
          dailyFiles
            .map(dailyFile =>
              client.request({ path: `${dailyFile}/hour`, method: 'GET' })
                .then(resp => getStream(resp.body))
                .then(body => JSON.parse(body).map(hour => `${dailyFile}/hour/${hour}`))
            )
        ))

        const files = type == "hourly" ? hourlyFiles : dailyFiles

        let counters = await Promise.all(
          files.map(path => extractKeyCount(client, path, 'export.bin', TemporaryExposureKeyExport))
        )

        res.send(counters)
      } catch (e) {
        console.log(e)
        res.statusMessage = e
        res.status(500).end()
      }
    })
  }
)

const server = http.createServer(app)
const port = process.env.PORT || 3000
server.listen(port)
console.debug('Server listening on port ' + port)

async function extractKeyCount(client, path, fileName, TemporaryExposureKeyExport) {
  const temporaryExposureKeyExport = await client
    .request({ path: path, method: 'GET', idempotent: true })
    .then(resp => {
      if (resp.statusCode != 200) {
        throw new Error(`Klaida ${resp.statusCode}`)
      }
      return resp.body.pipe(unzipper.ParseOne(fileName))
    })
    .then(content => getStream.buffer(content))
    .then(buffer => TemporaryExposureKeyExport.decode(buffer.slice(16)))

    return {
      "date": extractDate(path),
      "count": temporaryExposureKeyExport["keys"].length + temporaryExposureKeyExport["revisedKeys"].length
    }
}

function extractDate(keyValue) {
  var elems = keyValue.split("/")
  if (keyValue.includes("hour")) {
    var hour = `0${elems[elems.length - 1]}:00:00`.slice(-8)
    var date = elems[elems.length - 3]
    return `${date}T${hour}`
  } else {
    return elems[elems.length - 1]
  }
}
