import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSilence} from '../engine/analysis.mjs';
import {measuredSpeechCuts,remapWords} from '../engine/planner.mjs';
test('silence log parser handles leading, closed and trailing measured intervals',()=>{
  assert.deepEqual(parseSilence('silence_start: 0\nsilence_end: 1.2 | silence_duration: 1.2\nsilence_start: 4',5),[{start:0,end:1.2},{start:4,end:5}]);
});
test('automatic cuts require both a measured quiet interval and a word-free gap',()=>{
  const words=[{text:'AI',start:.3,end:1},{text:'सुरक्षा',start:3,end:4}];
  assert.deepEqual(measuredSpeechCuts(words,5,[]),[{start:0,end:5}]);
  const cuts=measuredSpeechCuts(words,5,[{start:1,end:3}]);assert.equal(cuts.length,2);
  assert.deepEqual(remapWords(words,cuts).map(w=>w.text),['AI','सुरक्षा']);
  for(const word of words)assert.ok(cuts.some(c=>word.start>=c.start&&word.end<=c.end));
});
