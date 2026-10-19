function fixJsonString(jsonStr) {
  let isInsideString = false;
  let isEscaped = false;
  let newStr = "";
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    
    if (char === '"' && !isEscaped) {
      isInsideString = !isInsideString;
      newStr += char;
    } else if (isInsideString) {
      if (char === '\n') {
        newStr += '\\n';
        isEscaped = false; // Reset escape after newline
      } else if (char === '\r') {
        newStr += '\\r';
        isEscaped = false;
      } else if (char === '\t') {
        newStr += '\\t';
        isEscaped = false;
      } else if (char === '\\' && !isEscaped) {
        isEscaped = true;
        let peek = jsonStr[i + 1];
        if (peek && !['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(peek)) {
          newStr += '\\\\';
        } else {
          newStr += char;
        }
      } else {
        isEscaped = false;
        newStr += char;
      }
    } else {
      newStr += char;
    }
  }
  return newStr;
}

const badJson = `{
  "file_path": "/tmp/math.sh",
  "content": "#!/bin/bash\necho 'Hello \\' world \\. !'\n"
}`;
// Wait, the string above is evaluated by JS so \n becomes real newline, \' becomes real ', \. becomes real .

const rawString = '{\n  "file_path": "/tmp/math.sh",\n  "content": "#!/bin/bash\necho \'Hello \\\' world \\. !\'\n"\n}';
console.log("Original:\n", rawString);
const fixed = fixJsonString(rawString);
console.log("Fixed:\n", fixed);
console.log("Parsed:", JSON.parse(fixed));
