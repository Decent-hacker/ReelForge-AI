import ts from 'typescript';
const configFile=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(configFile.error)throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText,'\n'));
const config=ts.parseJsonConfigFileContent(configFile.config,ts.sys,'.');
const program=ts.createProgram(config.fileNames,config.options);
const diagnostics=[...config.errors,...ts.getPreEmitDiagnostics(program)];
if(diagnostics.length){
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:ts.sys.getCurrentDirectory,getNewLine:()=>ts.sys.newLine}));process.exitCode=1;
}else console.log(`TypeScript ${ts.version}: type check passed.`);
