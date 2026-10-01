// Only explicit interface keys are translated; user content is never traversed.
window.BigaI18n=(()=>{
  const supported=['zh-CN','en-US','ja-JP'];
  const browser=navigator.language.toLowerCase();
  let language=localStorage.getItem('bigacli-language');
  if(!supported.includes(language))language=browser.startsWith('zh')?'zh-CN':browser.startsWith('ja')?'ja-JP':'en-US';
  function t(key,...values){
    const translated=language==='zh-CN'?key:window.BIGA_TRANSLATIONS[key]?.[language==='en-US'?0:1]??key;
    return String(translated).replace(/\{(\d+)\}/g,(match,index)=>index<values.length?String(values[index]):match);
  }
  function apply(root=document){
    document.documentElement.lang=language;
    for(const node of root.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
    for(const attr of ['title','placeholder','aria-label'])for(const node of root.querySelectorAll('[data-i18n-'+attr+']'))node.setAttribute(attr,t(node.getAttribute('data-i18n-'+attr)));
  }
  function setLanguage(value){if(!supported.includes(value))return;language=value;localStorage.setItem('bigacli-language',value);apply();}
  function error(value){
    if(typeof value!=='string')return value;
    if(/\bENOSPC\b|\bSQLITE_FULL\b|no space left on device|database or disk is full|os error 112|磁盘空间不足/i.test(value))return t('磁盘空间不足，任务已暂停。请清理空间后重试。');
    if(window.BIGA_TRANSLATIONS[value])return t(value);
    const separator=value.indexOf('：');
    if(separator>=0){const prefix=value.slice(0,separator+1),head=value.slice(0,separator);if(window.BIGA_TRANSLATIONS[prefix])return t(prefix)+error(value.slice(separator+1));if(window.BIGA_TRANSLATIONS[head])return t(head)+': '+value.slice(separator+1);}
    return value;
  }
  return {t,error,apply,setLanguage,get language(){return language;}};
})();
