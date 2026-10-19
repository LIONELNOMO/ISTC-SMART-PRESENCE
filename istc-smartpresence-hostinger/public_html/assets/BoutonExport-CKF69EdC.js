import{c as y,r as b,o as z,j as c,B as T,K as E}from"./index-CF4PgCzL.js";import{d as R,t as N,n as M}from"./tabular-Lhgx3Bf9.js";import{F as P}from"./file-text-CFcj7ZMx.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L=y("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A=y("FileSpreadsheet",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M8 13h2",key:"yr2amv"}],["path",{d:"M14 13h2",key:"un5t4a"}],["path",{d:"M8 17h2",key:"2yhykz"}],["path",{d:"M14 17h2",key:"10kma7"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=y("FileType",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M9 13v-1h6v1",key:"1bb014"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M11 18h2",key:"12mj7e"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const q=y("Table2",[["path",{d:"M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18",key:"gugj83"}]]),k=[{id:"pdf",label:"PDF",extension:"pdf",description:"Pour imprimer ou archiver"},{id:"excel",label:"Excel",extension:"xls",description:"Pour recalculer"},{id:"word",label:"Word",extension:"doc",description:"Pour commenter"},{id:"csv",label:"CSV",extension:"csv",description:"Pour un autre logiciel"}];function i(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function S(e,t){const s=typeof e.value=="function"?e.value(t):t[e.key];return s==null?"":String(s)}function v(e,t){return`${String(e).normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"rapport"}.${t}`}function w(e,t,s){const n=new Blob([t],{type:s}),r=URL.createObjectURL(n),o=document.createElement("a");o.href=r,o.download=e,o.rel="noopener",document.body.appendChild(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(r),1e3)}function W(e){const t=String(e).replace(/\s| /g,"").replace(",",".");return t!==""&&Number.isFinite(Number(t))}function B(e){return Number(String(e).replace(/\s| /g,"").replace(",","."))}function O({titre:e,colonnes:t,lignes:s,meta:n=[]}){const r=t.map(a=>`<Cell ss:StyleID="entete"><Data ss:Type="String">${i(a.label??a.key)}</Data></Cell>`).join(""),o=s.map(a=>`<Row>${t.map(u=>{const h=S(u,a);return u.numerique&&W(h)?`<Cell><Data ss:Type="Number">${B(h)}</Data></Cell>`:`<Cell><Data ss:Type="String">${i(M(h))}</Data></Cell>`}).join("")}</Row>`).join(""),p=n.map(a=>`<Row><Cell ss:StyleID="meta"><Data ss:Type="String">${i(a)}</Data></Cell></Row>`).join("");return`<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Title>${i(e)}</Title>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="titre">
      <Font ss:Bold="1" ss:Size="14" ss:Color="#2A1C12"/>
    </Style>
    <Style ss:ID="meta">
      <Font ss:Size="9" ss:Color="#8D7D6F"/>
    </Style>
    <Style ss:ID="entete">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#311F13" ss:Pattern="Solid"/>
      <Alignment ss:Vertical="Center"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Rapport">
    <Table>
      <Row><Cell ss:StyleID="titre"><Data ss:Type="String">${i(e)}</Data></Cell></Row>
      ${p}
      <Row/>
      <Row>${r}</Row>
      ${o}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>${3+n.length}</SplitHorizontal>
      <TopRowBottomPane>${3+n.length}</TopRowBottomPane>
      <ActivePane>2</ActivePane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`}const $=`
  @page { size: A4 landscape; margin: 1.4cm; }
  body { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 10pt; color: #2a1c12; }
  .entete { border-bottom: 2px solid #cc6c25; padding-bottom: 10px; margin-bottom: 16px; }
  .etablissement { font-size: 9pt; color: #8d7d6f; letter-spacing: .08em; text-transform: uppercase; }
  h1 { font-size: 17pt; margin: 6px 0 2px; color: #2a1c12; }
  .meta { font-size: 8.5pt; color: #8d7d6f; margin: 2px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th { background: #311f13; color: #fff; font-size: 8.5pt; text-align: left;
       padding: 7px 8px; text-transform: uppercase; letter-spacing: .05em; }
  td { border-bottom: 1px solid #e8e0d6; padding: 6px 8px; font-size: 9.5pt; }
  tr:nth-child(even) td { background: #fbf5ed; }
  td.num, th.num { text-align: right; }
  .pied { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e8e0d6;
          font-size: 8pt; color: #8d7d6f; }
`;function C({titre:e,colonnes:t,lignes:s,meta:n,etablissement:r}){const o=t.map(d=>`<th class="${d.numerique?"num":""}">${i(d.label??d.key)}</th>`).join(""),p=s.map(d=>`<tr>${t.map(u=>`<td class="${u.numerique?"num":""}">${i(S(u,d))}</td>`).join("")}</tr>`).join(""),a=new Date().toLocaleString("fr-FR",{dateStyle:"long",timeStyle:"short"});return`
    <div class="entete">
      ${r?`<div class="etablissement">${i(r)}</div>`:""}
      <h1>${i(e)}</h1>
      ${n.map(d=>`<p class="meta">${i(d)}</p>`).join("")}
    </div>
    <table>
      <thead><tr>${o}</tr></thead>
      <tbody>${p}</tbody>
    </table>
    <p class="pied">
      ${s.length} ligne${s.length>1?"s":""} ·
      Édité le ${i(a)} · ISTC SmartPresence
    </p>`}function V({titre:e,colonnes:t,lignes:s,meta:n=[],etablissement:r=null}){return`<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${i(e)}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
  </xml><![endif]-->
  <style>${$}</style>
</head>
<body>${C({titre:e,colonnes:t,lignes:s,meta:n,etablissement:r})}</body>
</html>`}function H({titre:e,colonnes:t,lignes:s,meta:n=[],etablissement:r=null}){const o=window.open("","_blank","noopener,noreferrer,width=1100,height=760");return o?(o.document.write(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${i(e)}</title>
  <style>${$}</style>
</head>
<body>${C({titre:e,colonnes:t,lignes:s,meta:n,etablissement:r})}</body>
</html>`),o.document.close(),o.addEventListener("load",()=>{o.focus(),o.print()}),setTimeout(()=>{try{o.document.readyState==="complete"&&(o.focus(),o.print())}catch{}},350),{ok:!0}):{ok:!1,message:"Le navigateur a bloqué la fenêtre d'impression. Autorisez les fenêtres surgissantes pour ce site, puis réessayez."}}function U({format:e,titre:t,nomFichier:s,colonnes:n,lignes:r,meta:o=[],etablissement:p=null}){if(!(r!=null&&r.length))return{ok:!1,message:"Aucune ligne à exporter sur cette période."};const a=s??t;return e==="csv"?(R(v(a,"csv"),N(n,r)),{ok:!0}):e==="excel"?(w(v(a,"xls"),O({titre:t,colonnes:n,lignes:r,meta:o}),"application/vnd.ms-excel;charset=utf-8"),{ok:!0}):e==="word"?(w(v(a,"doc"),V({titre:t,colonnes:n,lignes:r,meta:o,etablissement:p}),"application/msword;charset=utf-8"),{ok:!0}):e==="pdf"?H({titre:t,colonnes:n,lignes:r,meta:o,etablissement:p}):{ok:!1,message:"Format inconnu."}}const Z={pdf:I,excel:A,word:P,csv:q};function G({rapport:e,libelle:t="Exporter",desactive:s=!1,variant:n="secondary",taille:r="md",className:o}){const[p,a]=b.useState(!1),[d,u]=b.useState(null),h=b.useRef(null),g=z();b.useEffect(()=>{if(!p)return;const l=m=>{var x;(x=h.current)!=null&&x.contains(m.target)||a(!1)},f=m=>{m.key==="Escape"&&a(!1)};return document.addEventListener("pointerdown",l),document.addEventListener("keydown",f),()=>{document.removeEventListener("pointerdown",l),document.removeEventListener("keydown",f)}},[p]);const D=l=>{var f;u(l);try{const m=e(),x=U({...m,format:l});if(!x.ok){g.erreur("Export impossible",x.message);return}const F=((f=k.find(j=>j.id===l))==null?void 0:f.label)??l;g.succes(l==="pdf"?"Aperçu ouvert":`Export ${F} produit`,l==="pdf"?"Choisissez « Enregistrer au format PDF » dans la fenêtre d’impression.":`${m.lignes.length} ligne${m.lignes.length>1?"s":""} exportée${m.lignes.length>1?"s":""}.`)}catch{g.erreur("Export impossible","Le rapport n'a pas pu être produit.")}finally{u(null),a(!1)}};return c.jsxs("div",{ref:h,className:E("relative",o),children:[c.jsxs(T,{variant:n,size:r,disabled:s,onClick:()=>a(l=>!l),"aria-haspopup":"menu","aria-expanded":p,children:[c.jsx(L,{className:"size-4","aria-hidden":!0}),t]}),p&&c.jsxs("div",{role:"menu",className:"animate-pop absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-card border border-line bg-surface shadow-pop",children:[c.jsx("p",{className:"border-b border-line bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint",children:"Format du rapport"}),c.jsx("ul",{className:"p-1",children:k.map(l=>{const f=Z[l.id];return c.jsx("li",{children:c.jsxs("button",{type:"button",role:"menuitem",disabled:d!==null,onClick:()=>D(l.id),className:"flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent-soft/50 disabled:opacity-50",children:[c.jsx(f,{className:"size-4 shrink-0 text-accent-text","aria-hidden":!0}),c.jsxs("span",{className:"min-w-0 flex-1",children:[c.jsx("span",{className:"block text-[13px] font-medium text-ink",children:l.label}),c.jsx("span",{className:"block text-[11px] text-faint",children:l.description})]})]})},l.id)})})]})]})}export{G as B};
