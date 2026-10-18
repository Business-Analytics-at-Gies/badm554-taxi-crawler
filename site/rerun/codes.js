// Browser convenience only. Server receipts are bound to the signed-in session.
export const KEY = 'rerun.codes';
export const validCode = (floor,code) => [1,2,3].includes(Number(floor)) && typeof code==='string' && new RegExp(`^RERUN-${floor}-[A-Z]{8}$`).test(code);
export function readCodes() {
  try { const value=JSON.parse(localStorage.getItem(KEY)), out={}; for(const floor of [1,2,3]) if(validCode(floor,value?.[floor]))out[floor]=value[floor];return out; }catch{return {};}
}
export function writeCodes(codes) { try {const out={};for(const floor of [1,2,3])if(validCode(floor,codes[floor]))out[floor]=codes[floor];localStorage.setItem(KEY,JSON.stringify(out));}catch{} }
export function clearCodes(){try{localStorage.removeItem(KEY);}catch{}}
