const http = require('http')
const express = require('express')
const app = express()
const unzipper = require('unzipper')
const protobuf = require('protobufjs')
const { Client, Pool } = require('undici')
const getStream = require('get-stream')

const urls = {
  'LT': 'https://download.koronastop.lt',
  'DE': 'https://svc90.main.px.t-online.de',
  'NO': 'https://be-op.ss2.fhi.no'
}
 
app.use(express.json())
app.use(express.static('.'))

const TemporaryExposureKeyExport = protobuf.loadSync("gaen.proto").lookupType("TemporaryExposureKeyExport")

app.get('/data/NO', async function(req, res) {
  const url = urls['NO']
  const client = new Client(url, { pipelining: 0 })
  const twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 10))
  const counters = {}
  var currentDate = twoWeeksAgo

  while (currentDate <= new Date()) {
    const dt = currentDate.toISOString().substring(0, 10);
    var batchNumber = 1
    var nextbatchexists = true
    while (nextbatchexists) {
      const path = `/api/v3/diagnostickeys/${dt}_${batchNumber++}_no.zip`
      const resp = await extractKeyCount(
        client, path, 'export.bin', dt, {'Authorization_Mobile': '5e7VejU56Ea9CJ2XKCU5Wn8BxFmEzQPB'}
      )
      if (dt in counters) {
        counters[dt] += resp["count"]
      } else {
        counters[dt] = resp["count"]
      }
      nextbatchexists = "nextbatchexists" in resp.headers && resp.headers["nextbatchexists"] == "True"
    }
    currentDate.setDate(currentDate.getDate() + 1)
  }

  res.send(
    Object.entries(counters).map(el => ({'date': el[0], 'count': el[1]}))
  )

})

app.get('/data/:countryCode(LT|DE)/:type', async function(req, res) {
  const cc = req.params.countryCode
  const type = req.params.type
  const url = urls[cc]
  const client = new Client(url, { pipelining: 10 } )
  try {
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
      files.map(path => extractKeyCount(client, path, 'export.bin', extractDate(path)))
    )

    res.send(counters)
  } catch (e) {
    console.log(e)
    res.statusMessage = e
    res.status(500).end()
  }
}
)

const server = http.createServer(app)
const port = process.env.PORT || 3000
server.listen(port)
console.debug('Server listening on port ' + port)

async function extractKeyCount(client, path, fileName, dt, headers) {
  const response = await client
    .request({ path: path, method: 'GET', headers: headers, idempotent: true })
    .then(resp => {
      if (resp.statusCode < 200 || resp.statusCode > 204) {
        throw new Error(`Error ${resp.statusCode}`)
      }
      return resp
    })

  var keyCount = 0

  if (response.statusCode == 200) {
    const buffer = await getStream.buffer(response.body.pipe(unzipper.ParseOne(fileName)))
    const keys = await TemporaryExposureKeyExport.decode(buffer.slice(16))
    keyCount = keys["keys"].length + keys["revisedKeys"].length
  }

  return {
    "date": dt,
    "headers": response["headers"],
    "count": keyCount,
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
