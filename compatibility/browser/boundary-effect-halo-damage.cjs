'use strict';
// Experimental source-operation dirty bounds for Gaussian/alpha-mask/miter scenes.
// This estimates INVALIDATION only; raster reads extra halo, handled separately.
// Unlike the prior fallback planner it does not forcibly promote all effects
// to a full-frame invalidation; strict browser parity determines viability.
const {states,rect,validate}=require('./boundary-effect-damage.cjs');
function estimate(oldState,newState,w,h){
 validate(oldState);validate(newState);
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<=0||h<=0)throw Error('Invalid canvas');
 if(JSON.stringify(oldState)===JSON.stringify(newState))
  return {rects:[],area:0,reason:'unchanged',fullFallback:false};
 const a=rect(oldState,w,h),b=rect(newState,w,h);
 if(!a&&!b)return {rects:[],area:0,reason:'both-outside',fullFallback:false};
 const x=Math.min(a?.x??w,b?.x??w),y=Math.min(a?.y??h,b?.y??h);
 const r=Math.max(a?a.x+a.w:0,b?b.x+b.w:0);
 const bottom=Math.max(a?a.y+a.h:0,b?b.y+b.h:0);
 const pad=oldState.mode>=2||newState.mode>=2?24:0;
 const x0=Math.max(0,x-pad),y0=Math.max(0,y-pad);
 const x1=Math.min(w,r+pad),y1=Math.min(h,bottom+pad);
 const candidate={x:x0,y:y0,w:x1-x0,h:y1-y0};
 if(candidate.w<=0||candidate.h<=0)return {rects:[],area:0,reason:'no-visible-bounds',fullFallback:false};
 return {rects:[candidate],area:candidate.w*candidate.h,reason:'command-stroke-mask-filter-hull',
  fullFallback:false};
}
module.exports={estimate,states};
