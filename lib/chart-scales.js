export function chartScales({horizontal=false,currency=false,axisUnit='Units'},formatValue=String) {
  function categoryLabel(value) { return this.getLabelForValue(value); }
  return {
    x:{type:horizontal?'linear':'category',grid:{display:horizontal,color:'#e5e9ee'},border:{display:false},title:{display:horizontal,text:axisUnit,color:'#687586',font:{size:12}},ticks:{color:'#687586',font:{size:11},maxRotation:0,callback:horizontal?formatValue:categoryLabel},beginAtZero:horizontal},
    y:{type:horizontal?'category':'linear',grid:{display:!horizontal,color:'#e5e9ee'},border:{display:false},title:{display:!horizontal,text:axisUnit,color:'#687586',align:'end',font:{size:12}},ticks:{color:'#687586',font:{size:11},precision:currency?undefined:0,callback:horizontal?categoryLabel:formatValue},beginAtZero:!horizontal}
  };
}
