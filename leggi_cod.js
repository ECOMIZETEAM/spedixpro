const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2]);
const ws = wb.Sheets[wb.SheetNames[0]];
const righe = XLSX.utils.sheet_to_json(ws);
console.log('INTESTAZIONI:', JSON.stringify(Object.keys(righe[0] || {})));
console.log('PRIMA RIGA:', JSON.stringify(righe[0] || {}));
