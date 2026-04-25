import{b1 as c,a$ as o}from"./index-C0sN1PXu.js";const r=new o("antFadeIn",{"0%":{opacity:0},"100%":{opacity:1}}),s=new o("antFadeOut",{"0%":{opacity:1},"100%":{opacity:0}}),p=(i,t=!1)=>{const{antCls:e}=i,n=`${e}-fade`,a=t?"&":"";return[c(n,r,s,i.motionDurationMid,t),{[`
        ${a}${n}-enter,
        ${a}${n}-appear
      `]:{opacity:0,animationTimingFunction:"linear"},[`${a}${n}-leave`]:{animationTimingFunction:"linear"}}]};export{p as i};
