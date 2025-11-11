const fs = require('fs');
const file = process.argv[2] || 'index.js';
const src = fs.readFileSync(file, 'utf8');

const stack = [];
let line = 1, col = 0;
let inStr = false, strCh = '';
let inLine = false, inBlock = false;
let escape = false;

function push(t){ stack.push({t,line,col}); }
function pop(t){ 
  const top = stack.pop();
  if (!top || top.t !== t) {
    console.log(`Mismatch: expected '${t}' but got '${top?top.t:'<none>'}' at line ${line}, col ${col}`);
    process.exit(1);
  }
}

for (let i=0;i<src.length;i++){
  const ch = src[i];
  col++;
  if (ch === '\n'){ line++; col = 0; inLine = false; continue; }

  if (inLine) continue;

  if (inBlock){
    if (ch === '*' && src[i+1] === '/') { inBlock = false; i++; col++; }
    continue;
  }

  if (inStr){
    if (escape){ escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === strCh) { inStr = false; strCh = ''; }
    continue;
  }

  // start comments
  if (ch === '/' && src[i+1] === '/') { inLine = true; i++; col++; continue; }
  if (ch === '/' && src[i+1] === '*') { inBlock = true; i++; col++; continue; }

  // start strings
  if (ch === '"' || ch === "'" || ch === '`'){ inStr = true; strCh = ch; continue; }

  // track braces/parens/brackets
  if (ch === '{') push('{');
  else if (ch === '}') {
    if (!stack.length || stack[stack.length-1].t !== '{'){
      console.log(`Extra '}' at line ${line}, col ${col}`);
      process.exit(1);
    }
    pop('{');
  } else if (ch === '(') push('(');
  else if (ch === ')') {
    if (!stack.length || stack[stack.length-1].t !== '('){
      console.log(`Extra ')' at line ${line}, col ${col}`);
      process.exit(1);
    }
    pop('(');
  } else if (ch === '[') push('[');
  else if (ch === ']') {
    if (!stack.length || stack[stack.length-1].t !== '['){
      console.log(`Extra ']' at line ${line}, col ${col}`);
      process.exit(1);
    }
    pop('[');
  }
}

if (stack.length){
  const first = stack[stack.length-1];
  console.log(`Missing closing for '${first.t}' opened at line ${first.line}, col ${first.col}`);
  process.exit(1);
}

console.log("✅ Braces/parentheses/brackets look balanced.");
