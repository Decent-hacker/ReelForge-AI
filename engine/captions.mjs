export function assEscape(text) { return String(text).replace(/\\/g, '／').replace(/[{}]/g, '').replace(/\r?\n/g, ' '); }
function time(s) { const cs = Math.max(0,Math.round(s*100)); return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`; }
function color(hex) { return `&H00${hex.slice(5,7)}${hex.slice(3,5)}${hex.slice(1,3)}`; }
export function makeAss(plan, preferences, omit = new Set()) {
  const {width:w,height:h,captionFont:font,accent}=preferences;
  const fs=Math.round(w*0.061);
  const lines=['[Script Info]','ScriptType: v4.00+',`PlayResX: ${w}`,`PlayResY: ${h}`,'WrapStyle: 0','ScaledBorderAndShadow: yes',
    '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font},${fs},&H00FFFFFF,${color(accent)},&H0014110F,&H9014110F,-1,0,0,0,100,100,0,0,1,${Math.round(w*.004)},1,2,${Math.round(w*.08)},${Math.round(w*.08)},${Math.round(h*.23)},1`,
    `Style: Title,${font},${Math.round(fs*.66)},${color(accent)},&H00FFFFFF,&H0014110F,&H0014110F,-1,0,0,0,100,100,1,0,3,12,0,8,45,45,${Math.round(h*.16)},1`,
    '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
  if (!omit.has('captions')) for (let i=0;i<plan.words.length;i+=3) {
    const group=plan.words.slice(i,i+3);
    for(let k=0;k<group.length;k++) {
      const active=group[k], end=Math.min(active.end,plan.duration);
      const text=group.map((word,j)=>`{\\c${!omit.has('keywords') && word.keyword ? color(accent) : '&H00FFFFFF'}${j===k?'\\u1':'\\u0'}}${assEscape(word.text)}`).join(' ');
      const pop=omit.has('animation')?'':`{\\fscx88\\fscy88\\t(0,95,\\fscx105\\fscy105)\\t(95,170,\\fscx100\\fscy100)\\fad(25,25)}`;
      lines.push(`Dialogue: 1,${time(active.start)},${time(end)},Caption,,0,0,0,,${pop}${text}`);
    }
  }
  if (!omit.has('graphics')) for (const s of plan.scenes) {
    const y=Math.round(h*.16), end=Math.min(s.end,s.start+1.6);
    lines.push(`Dialogue: 0,${time(s.start)},${time(end)},Title,,0,0,0,,{\\move(${-w},${y},${w/2},${y},0,240)\\fad(50,160)}${assEscape(s.title)}`);
  }
  return lines.join('\n');
}
