#!/usr/bin/env node
// screen_v225_node.js -- Node port of the offline KaTeX screener, v2.2.5.
// The decision logic is a line-by-line copy of the evaluation-set screener
// screen_v22.js (frozen at v2.2.5, JXA/JavaScriptCore host):
//   markdown-it-math-style span splitting (braces are not counted), escape
//   checks for two-character delimiter tokens in hasAnyDelim, "strict throw
//   means error class", single-$ currency exclusion, and whole-body parsing of
//   a bare formula after implicitly adding delimiters.
// Host differences only: JXA readFile/eval replaced by node fs/require (katex
//   pinned to 0.16.47), streaming line-by-line input, plus passing sample_id
//   through and writing a summary.
// Usage: node screen_v225_node.js <in.jsonl> <out_hits.json> [textField] [idField] [summary.json]
'use strict';
var fs = require('fs');
var readline = require('readline');
var origLog = console.log.bind(console);
console.warn = function(){}; console.log = function(){}; console.error = function(){}; console.info = function(){};
var path = require('path');
// KaTeX is version-pinned and bundled next to the renderer; resolve it relative
// to this script so the screener and the renderer always agree on the version.
var katex = require(path.join(__dirname, '..', 'assets', 'katex-0.16.47', 'katex.min.js'));

var MATH_DELIMS = [["$$","$$",true,true],["\\[","\\]",true,true],["\\(","\\)",false,true],["$","$",false,false]];
var HTML_BOUNDARY_RE = /(?:<\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?\s*\/?\s*>|&lt;\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^&<>]*)?\s*\/?\s*&gt;)/i;
var STRONG_MATH_RE = /(\\|[_^{}=<>+*\/]|[A-Za-z]\s*'+\s*(?:\(|[A-Za-z0-9])|\b(?:alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|sqrt|frac|sum|int|lfloor|rfloor|mathrm|mathbb|operatorname|begin|end|times|cdot|leq|geq|pmod)\b)/;
var PROSE_WORD_RE = /\b(?:or|and|in|by|with|for|to|from|of|the|a|an)\b/i;
function isEscaped(text,pos){var n=0,i=pos-1;while(i>=0&&text[i]==='\\'){n++;i--;}return n%2===1;}
function unescapeHtml(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,function(_,d){return String.fromCharCode(parseInt(d,10));}).replace(/&#x([0-9A-Fa-f]+);/g,function(_,h){return String.fromCharCode(parseInt(h,16));}).replace(/&amp;/g,'&').replace(/ /g,' ');}
function acceptSingleDollar(inner){
  var body=inner.trim();
  if(!body)return false;
  if(STRONG_MATH_RE.test(body))return true;
  if(/[0-9]/.test(body[0])&&PROSE_WORD_RE.test(body))return false;
  return true;
}
function acceptSpan(inner,isDisp,left){
  if(HTML_BOUNDARY_RE.test(inner))return false;
  if(left==='$'&&!acceptSingleDollar(inner))return false;
  return true;
}
// v2.2.3: delimiter pairing is structurally identical to the markdown-it math
// plugin: braces are not counted; whatever pairs up is fed straight to KaTeX.
function splitMathSpans(text,isFormula){
  var spans=[],buf=[],i=0,n=text.length;
  while(i<n){
    var matched=false;
    for(var d=0;d<MATH_DELIMS.length;d++){
      var left=MATH_DELIMS[d][0],right=MATH_DELIMS[d][1],isDisp=MATH_DELIMS[d][2],allowNl=MATH_DELIMS[d][3];
      if(text.substr(i,left.length)!==left||isEscaped(text,i))continue;
      var j=i+left.length,end=-1;
      while(j<n){var k=text.indexOf(right,j);if(k<0)break;if(isEscaped(text,k)){j=k+1;continue;}end=k;break;}
      if(end<0)continue;
      var inner=text.slice(i+left.length,end);
      if(!inner.trim())continue;
      if(!allowNl&&inner.indexOf('\n')>=0)continue;
      var ok = isFormula ? !(left==='$'&&!acceptSingleDollar(inner)) : acceptSpan(inner,isDisp,left);
      if(!ok){buf.push(text.substr(i,left.length));i+=left.length;matched=true;break;}
      spans.push({display:isDisp,payload:inner});
      i=end+right.length;matched=true;break;
    }
    if(!matched){buf.push(text[i]);i++;}
  }
  return {spans:spans,residue:buf.join('')};
}
function hasAnyDelim(t){
  // v2.2.5: two-character tokens are escape-checked too, same as splitMathSpans
  var i=0;
  while(i<t.length){
    if(t[i]==='$'&&!isEscaped(t,i))return true;
    if((t.substr(i,2)==='\\['||t.substr(i,2)==='\\]'||t.substr(i,2)==='\\('||t.substr(i,2)==='\\)')&&!isEscaped(t,i))return true;
    i++;
  }
  return false;
}
function residueIssues(res){
  var issues=[];
  var i=0;
  while(i<res.length){
    if(res[i]==='$'&&!isEscaped(res,i)){issues.push('stray:$');break;}
    if((res.substr(i,2)==='\\['||res.substr(i,2)==='\\]'||res.substr(i,2)==='\\('||res.substr(i,2)==='\\)')&&!isEscaped(res,i)){issues.push('stray:'+res.substr(i,2));break;}
    i++;
  }
  var m=res.match(/\\[A-Za-z]{2,}/g);
  if(m)issues.push('naked:'+m.slice(0,5).join(','));
  return issues;
}
function tryParse(body,display){
  // v2.2.4: markdown-it-math semantics -- a throw in strict mode is an error class
  try{ katex.renderToString(body,{throwOnError:true,displayMode:display}); return null; }
  catch(e){ return String(e).slice(0,300); }
}
function screenRow(row,textField,idField){
  var cand=String(row[textField]||'');
  var cat=String(row.category||'');
  var rec={id:row[idField],category:cat,label:String(row.label),status:'pass',reasons:[],errors:[]};
  if(row.sample_id!==undefined)rec.sample_id=row.sample_id;
  if(cat==='formula'){
    var t=cand.trim();
    if(!hasAnyDelim(t)){
      // Bare formula body: implicitly add delimiters and parse the whole body
      var err=tryParse(t,true);
      if(err){rec.status='body_error';rec.errors.push(err);}
      else if(!t){rec.status='body_error';rec.errors.push('empty');}
    }else{
      // Real markdown semantics: split into math spans and parse each one
      var sr=splitMathSpans(t,true);
      for(var si=0;si<sr.spans.length;si++){
        var e2=tryParse(unescapeHtml(sr.spans[si].payload.trim()),sr.spans[si].display);
        if(e2)rec.errors.push(e2);
      }
      if(rec.errors.length)rec.status='span_error';
      var ri=residueIssues(sr.residue);
      if(ri.length){rec.reasons=ri;if(rec.status==='pass')rec.status='residue_error';}
      if(sr.spans.length===0&&rec.status==='pass'){rec.status='residue_error';rec.reasons.push('no_valid_span');}
    }
  }else{
    var sr2=splitMathSpans(cand,false);
    for(var sj=0;sj<sr2.spans.length;sj++){
      var e3=tryParse(unescapeHtml(sr2.spans[sj].payload.trim()),sr2.spans[sj].display);
      if(e3)rec.errors.push(e3);
    }
    if(rec.errors.length)rec.status='span_error';
  }
  return rec;
}
async function main(){
  var argv=process.argv.slice(2);
  var inPath=argv[0], outPath=argv[1], textField=argv[2]||'label_text', idField=argv[3]||'case_id', summaryPath=argv[4]||null;
  var rl=readline.createInterface({input:fs.createReadStream(inPath),crlfDelay:Infinity});
  var results=[],n=0;
  var summary={total:0,hits:0,by_status:{},by_cat_label:{}};
  for await (var line of rl){
    if(!line.trim())continue;
    var row=JSON.parse(line);
    var rec=screenRow(row,textField,idField);
    n++;summary.total++;
    var ck=rec.category+'/'+rec.label;
    if(!summary.by_cat_label[ck])summary.by_cat_label[ck]={total:0,hits:0};
    summary.by_cat_label[ck].total++;
    if(rec.status!=='pass'){
      results.push(rec);
      summary.hits++;
      summary.by_status[rec.status]=(summary.by_status[rec.status]||0)+1;
      summary.by_cat_label[ck].hits++;
    }
    if(n%20000===0)process.stderr.write('processed '+n+' hits '+results.length+'\n');
  }
  fs.writeFileSync(outPath,JSON.stringify(results,null,1));
  if(summaryPath)fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2));
  origLog('screened '+n+' hits '+results.length);
}
main().catch(function(e){process.stderr.write('FATAL '+e.stack+'\n');process.exit(1);});
