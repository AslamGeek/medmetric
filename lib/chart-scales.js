export function sharedValueRange(values) {
  const known=values.filter(value=>typeof value==='number'&&Number.isFinite(value));
  const low=Math.min(0,...known),high=Math.max(0,...known);
  if(low===high)return {min:0,max:1};
  const rawStep=(high-low)/5,power=10**Math.floor(Math.log10(rawStep));
  const step=[1,2,5,10].find(value=>value>=rawStep/power)*power;
  return {min:Math.floor(low/step)*step,max:Math.ceil(high/step)*step};
}

export function chartScales({horizontal=false,currency=false,axisUnit='Units',valueRange},formatValue=String) {
  function categoryLabel(value) { return this.getLabelForValue(value); }
  const bounds=valueRange?{min:valueRange.min,max:valueRange.max}:{};
  return {
    x:{...(horizontal?bounds:{}),type:horizontal?'linear':'category',grid:{display:horizontal,color:'#e5e9ee'},border:{display:false},title:{display:horizontal,text:axisUnit,color:'#687586',font:{size:12}},ticks:{color:'#687586',font:{size:11},maxRotation:0,callback:horizontal?formatValue:categoryLabel},beginAtZero:horizontal},
    y:{...(!horizontal?bounds:{}),type:horizontal?'category':'linear',grid:{display:!horizontal,color:'#e5e9ee'},border:{display:false},title:{display:!horizontal,text:axisUnit,color:'#687586',align:'end',font:{size:12}},ticks:{color:'#687586',font:{size:11},precision:currency?undefined:0,callback:horizontal?categoryLabel:formatValue},beginAtZero:!horizontal}
  };
}
