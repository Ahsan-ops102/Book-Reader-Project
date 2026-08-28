const fs = require('fs');
const FormData = require('form-data');
const http = require('http');

const form = new FormData();
form.append('file', Buffer.from('test docx content'), {
  filename: 'test.docx',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
});
form.append('title', 'test docx');

const req = http.request({
  host: 'localhost',
  port: 3001,
  path: '/api/documents/upload',
  method: 'POST',
  headers: form.getHeaders()
}, res => {
  console.log('Status:', res.statusCode);
  res.on('data', d => console.log(d.toString()));
});
form.pipe(req);
