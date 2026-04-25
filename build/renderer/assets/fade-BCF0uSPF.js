import{b8 as c,b6 as o}from"./index-CPexoVzF.js";const r=new o("antFadeIn",{"0%":{opacity:0},"100%":{opacity:1}}),s=new o("antFadeOut",{"0%":{opacity:1},"100%":{opacity:0}}),p=(t,a=!1)=>{const{antCls:e}=t,n=`${e}-fade`,i=a?"&":"";return[c(n,r,s,t.motionDurationMid,a),{[`
        ${i}${n}-enter,
        ${i}${n}-appear
      `]:{opacity:0,animationTimingFunction:"linear"},[`${i}${n}-leave`]:{animationTimingFunction:"linear"}}]};export{p as i};
