(function(){
  var btn=document.getElementById('theme-toggle');
  if(!btn) return;
  var sync=function(){btn.setAttribute('aria-pressed',String(document.documentElement.classList.contains('dark')))};
  btn.addEventListener('click',function(){
    var dark=document.documentElement.classList.toggle('dark');
    try{localStorage.setItem('blw-theme',dark?'dark':'light')}catch(e){}
    sync();
  });
  sync();
})();
