const http = require('http')
const request = require('request')
const fetch = require('node-fetch')
const express = require('express')
const app = express()
const unzipper = require('unzipper')
const protobuf = require('protobufjs')
var xpath = require('xpath')
var dom = require('xmldom').DOMParser

const url = 'https://download.koronastop.lt'
 
app.use(express.json())
app.use(express.static('express'))
app.use(express.static('.'))
app.use('/data', async function(req, res) {
    protobuf.load("gaen.proto", async function (err, root) {
      var counters = {}
      // res.send([{"date": "2020-10-10T12:00:00", "count": 1}, {"date": "2020-10-10T14:00:00", "count": 3}])
      try {
        var TemporaryExposureKeyExport = root.lookupType("TemporaryExposureKeyExport")
        var select = xpath.useNamespaces({"s3": "http://s3.amazonaws.com/doc/2006-03-01/"});
        var listBucketResult = await fetch(url)
        if (!listBucketResult.ok) {
          throw new Error(listBucketResult.statusText)
        }
        var xml = await listBucketResult.text()
        var doc = await new dom().parseFromString(xml)
        var hourlyKeyFiles = await select("//s3:Key[contains(text(), '/hour/')]/text()", doc)
          .map(node => node.nodeValue)
          .sort(function(a, b) { return extractDate(a) > extractDate(b) ? 1 : -1 })
          .map(hourlyKeyFile => extractKeyCount(url, hourlyKeyFile, 'export.bin', TemporaryExposureKeyExport))
        var counters = await Promise.all(hourlyKeyFiles)
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

async function extractKeyCount(url, path, fileName, TemporaryExposureKeyExport) {
  const directory = await unzipper.Open.url(request, url + '/' + path)
  const file = directory.files.find(d => d.path === fileName)
  const content = await file.buffer()
  const keys = content.slice(16)
  const hour = extractDate(path)
  var keyExport = TemporaryExposureKeyExport.decode(keys)
  return { "date": hour, "count": keyExport["keys"].length }
}

function extractDate(keyValue) {
  var elems = keyValue.split("/")
  var hour = `0${elems[elems.length - 1]}:00:00`.slice(-8)
  var date = elems[elems.length - 3]
  return `${date}T${hour}`
}
