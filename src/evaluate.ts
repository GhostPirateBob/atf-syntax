/**
 * Evaluator for ATF format strings: renders one track's title exactly as WACUP 1.99.57.25464 does.
 *
 * Written from WACUP's observable behaviour (differential testing against its real evaluator) and
 * docs/atf-spec-wacup-advanced-title-formatting.md. Pure TypeScript with no Node or DOM APIs, so it
 * runs in a browser Web Worker as well as in VS Code.
 *
 * Model: every format, function argument and `[…]` section is its own evaluation scope. A syntax
 * error replaces that scope's output with WACUP's message and stops the scope; the enclosing scope
 * carries on. An unknown function or a strict-arity violation also replaces the scope's output so
 * far, but evaluation continues after the call. Arguments are evaluated eagerly, left to right.
 * All lengths and offsets are UTF-16 code units, as in WACUP.
 *
 * @module evaluate
 */

import { MAX_ARGS, parse, ParseError } from './parser';

export interface EvalResult {
  /** What WACUP shows: the rendered title, or WACUP's error text for a syntax error. */
  text: string;
  /** Lower-case names of functions used whose behaviour isn't confirmed against WACUP's evaluator. Their output is rendered as `?`. Sorted, unique. */
  unsure: string[];
  /** Set when WACUP 1.99.57.25464 would never finish (it hangs). `text` is then ''. start/end = UTF-16 offsets of the offending call in `format`. */
  freeze?: { fn: string; start: number; end: number };
  /**
   * Set when the format needs more work than the evaluator allows (see `WORK_BUDGET`), for
   * example hundreds of megabyte-sized intermediate strings. Not a claim that WACUP hangs: it may
   * well finish. `text` is then ''.
   */
  tooHeavy?: true;
  /**
   * Set when the format has a syntax error (same object `parse()` returns). `text` is then what
   * WACUP shows: its message alone for an error at the top level, or the message inside the
   * surrounding output when the error is inside a function argument or `[…]` (WACUP evaluates
   * those separately, so e.g. `a$upper(x(y))b` shows `a[SYNTAX ERROR IN FORMATTING STRING (9)]b`).
   */
  error?: ParseError;
}

// ---------------------------------------------------------------------------------------------
// Character tables, observed from WACUP 1.99.57.25464 (Windows NLS data on the test machine).
// Ranges are base-36 code points; case runs are `start count delta [step]`.

const PUNCT_RANGES = 'x-1b,1m-1s,2j-2o,3f-3i,4h-5b,5z,6v,ou,p3,122-127,13d-13e,14u,14w,14z,152,16b-16c,16x-16y,170-171,17f,17i-17j,19m-19p,1ck,1ds-1e5,1kn-1kp,1us-1ut,1v4,2r8,2tr,2u2-2u3,2ys-2z6,30a-30d,32d,34g-34k,37u-37z,3cr,3tt-3u0,4fh-4fi,4gr-4gs,4iz-4j1,4l1-4l2,4pg-4pi,4pk-4pm,4qo-4qy,4zo-4zp,53y-53z,55q-55r,5ei-5eo,5kr-5kv,5mm-5mn,6c0-6cn,6cw-6df,6dh-6dt,6dv-6e6,6f1-6f2,6fh-6fi,6y1-6y2,7s8-7sl,7ut-7uu,7vq-7vz,877-87s,89k-89n,8ak-8al,8vt-8vw,8vy-8vz,934-94e,94g,9hd-9hf,9hk-9ht,9hw-9i7,9io,9j1,9ls,9ob,wst-wsv,wvn,wvy,x9w-x9z,xce-xcf,xf2-xf3,xgf,xng-xnj,1e0u-1e0v,1e6o-1e6x,1e7k-1e8i,1e8k-1e8x,1e8z,1e94,1e96-1e97,1edd-1edf,1edh-1edm,1edo-1edr,1ee2-1ee3,1ee7-1ee8,1eez-1ef1,1ef3,1efv,1efx,1efz-1eg5';
const DIGIT_RANGES = '1c-1l,19c-19l,1dc-1dl,1j4-1jd,1uu-1v3,1ye-1yn,21y-227,25i-25r,292-29b,2cm-2cv,2g6-2gf,2jq-2jz,2na-2nj,2ts-2u1,2xc-2xl,2zk-2zt,37k-37t,39s-3a1,4ps-4q1,4r4-4rd,4zq-4zz,53k-53t,5e8-5eh,5gw-5h5,5kw-5l5,5lc-5ll,wtc-wtl,xcg-xcp,xds-xe1,xn4-xnd,1eds-1ee1';
const UPPER_RUNS = '2p q -w 1,68 n -w 1,6w 7 -w 1,73 1 3d,75 o -1 2,8j 3 -1 2,8q 8 -1 2,97 n -1 2,ai 3 -1 2,ao 1 5f,ar 2 -1 2,aw 1 -1,b0 1 -1,b6 1 -1,b9 1 2p,bd 1 -1,be 1 4j,bi 1 3m,bl 3 -1 2,bs 1 -1,bx 1 -1,c0 1 -1,c4 2 -1 2,c9 1 -1,cd 1 -1,cf 1 1k,cm 1 -2,cp 1 -2,cs 1 -2,cu 8 -1 2,d9 1 -27,db 9 -1 2,dv 1 -2,dx 1 -1,e1 k -1 2,f7 9 -1 2,fw 1 -1,g2 1 -1,g7 5 -1 2,gg 1 8bj,gh 1 8bg,gj 1 -5u,gk 1 -5q,gm 2 -5p 1,gp 1 -5m,gr 1 -5n,gw 1 -5p,gz 1 -5r,h4 1 -5t,h5 1 -5v,h7 1 8af,hb 1 -5v,hd 1 8al,he 1 -5x,hh 1 -5y,hp 1 89z,hs 1 -62,hv 1 -62,i0 1 -62,i1 1 -1x,i2 2 -61 1,i4 1 -1z,ia 1 -63,oh 2 -1 2,on 1 -1,or 3 3m 1,q4 1 -12,q5 3 -11 1,q9 h -w 1,qr 9 -w 1,r0 1 -1s,r1 2 -1r 1,rb 1 -8,rd c -1 2,s2 1 7,s8 1 -1,sb 1 -1,ts w -w 1,uo g -28 1,v5 h -1 2,wb r -1 2,xu 7 -1 2,y7 1 -f,y9 16 -1 2,129 12 -1c 1,5tl 1 r9g,5tp 1 2xy,5xd 23 -1 2,61t 1c -1 2,64g 8 8 1,64w 6 8 1,65c 8 8 1,65s 8 8 1,668 6 8 1,66p 4 8 2,674 8 8 1,67k 2 22 1,67m 4 2e 1,67q 2 2s 1,67s 2 3k 1,67u 2 34 1,67w 2 3i 1,680 8 8 1,68g 8 8 1,68w 8 8 1,69c 2 8 1,69f 1 9,69v 1 9,6a8 2 8 1,6ao 2 8 1,6at 1 7,6b7 1 9,6ku 1 -s,6ls g -g 1,6mc 1 -1,79s q -q 1,8q8 1b -1c 1,8rl 1 -1,8rp 1 -8bv,8rq 1 -8bs,8rs 3 -1 2,8s3 1 -1,8s6 1 -1,8sh 1e -1 2,8w0 12 -5ls 1,wu9 g -1 2,wv7 6 -1 2,ww1 c -1 2,x0j 7 -1 2,x0z v -1 2,x2y 2 -1 2,x33 5 -1 2,x3g 1 -1,1ef5 q -w 1';
const LOWER_RUNS = '1t q w 1,5c n w 1,60 7 w 1,74 o 1 2,8i 3 1 2,8p 8 1 2,96 n 1 2,ag 1 -3d,ah 3 1 2,ap 1 5u,aq 2 1 2,au 1 5q,av 1 1,ax 2 5p 1,az 1 1,b2 1 27,b3 1 5m,b4 1 5n,b5 1 1,b7 1 5p,b8 1 5r,ba 1 5v,bb 1 5t,bc 1 1,bg 1 5v,bh 1 5x,bj 1 5y,bk 3 1 2,bq 1 62,br 1 1,bt 1 62,bw 1 1,by 1 62,bz 1 1,c1 2 61 1,c3 2 1 2,c7 1 63,c8 1 1,cc 1 1,ck 1 2,cn 1 2,cq 1 2,ct 8 1 2,da 9 1 2,dt 1 2,dw 1 1,dy 1 -2p,dz 1 -1k,e0 k 1 2,f4 1 -3m,f6 9 1 2,fu 1 8bv,fv 1 1,fx 1 -4j,fy 1 8bs,g1 1 1,g3 1 -5f,g4 1 1x,g5 1 1z,g6 5 1 2,og 2 1 2,om 1 1,p2 1 12,p4 3 11 1,p8 1 1s,pa 2 1r 1,pd h w 1,pv 9 w 1,r3 1 8,rc c 1 2,s7 1 1,s9 1 -7,sa 1 1,sd 3 -3m 1,sg g 28 1,sw w w 1,v4 h 1 2,wa r 1 2,xs 1 f,xt 7 1 2,y8 16 1 2,10x 12 1c 1,3a8 12 5ls 1,5xc 23 1 2,61s 1c 1 2,64o 8 -8 1,654 6 -8 1,65k 8 -8 1,660 8 -8 1,66g 6 -8 1,66x 4 -8 2,67c 8 -8 1,688 8 -8 1,68o 8 -8 1,694 8 -8 1,69k 2 -8 1,69m 2 -22 1,69o 1 -9,6a0 4 -2e 1,6a4 1 -9,6ag 2 -8 1,6ai 2 -2s 1,6aw 2 -8 1,6ay 2 -34 1,6b0 1 -7,6bc 2 -3k 1,6be 2 -3i 1,6bg 1 -9,6k2 1 s,6lc g g 1,6mb 1 1,792 q q 1,8ow 1b 1c 1,8rk 1 1,8rm 1 -8af,8rn 1 -2xy,8ro 1 -89z,8rr 3 1 2,8rx 1 -8bg,8ry 1 -8al,8rz 1 -8bj,8s2 1 1,8s5 1 1,8sg 1e 1 2,wu8 g 1 2,wv6 6 1 2,ww0 c 1 2,x0i 7 1 2,x0y v 1 2,x2x 2 1 2,x31 1 -r9g,x32 5 1 2,x3f 1 1,1ee9 q w 1';

const IGNORABLE_RANGES = '4t,nj,oo-op,ov-oz,p7,p9,pu,10k-10l,10o-10w,11z-120,128,13c,13f-13k,154-15b,163-167,16d-16n,16s-16t,17g-17h,18g,1e6,1fv-1fw,1iq-1j3,1kr-1kv,1m6-1m7,1mn,1ng-1nh,1nj-1s0,1vc,1vk,1vo,1vx-1vy,1w1-1w2,1wp,1wx,1wz-1x1,1x6-1x7,1xh-1xi,1xl-1xm,1xr-1xy,1y0-1y3,1y6,1yc-1yd,1yz-1z4,1z8,1zf-1zi,1zl-1zm,209,20h,20k,20n,20q-20r,20t,20z-212,215-216,21a-21c,21e-21k,21p,21r-21x,22e-22o,22s,232,236,23t,241,244,24a-24b,24m,24q,24u-24v,24x-25b,25g-25h,25s,25u-268,26c,26l-26m,26p-26q,27d,27l,27o,27u-27v,285-286,289-28a,28e-28l,28o-28r,28u,290-291,29k-29t,29w,2a3-2a5,2a9,2ae-2ag,2aj,2al,2ao-2aq,2at-2av,2az-2b1,2be-2bh,2bn-2bp,2bt,2by-2bz,2c1-2c6,2c8-2cl,2d7-2dc,2dg,2dp,2dt,2eh,2es,2ey-2f0,2f9,2fd,2fi-2fo,2fr,2fu-2fz,2g4-2g5,2gg-2gn,2gw-2gx,2h0,2h9,2hd,2i1,2ic,2ii-2ij,2it,2ix,2j2-2j8,2jb-2jh,2jj,2jo-2jp,2k0,2k3-2kh,2kk,2kt,2kx,2m3-2m4,2md,2mh,2mn-2mu,2mw-2n3,2n8-2n9,2nq-2ns,2o0-2o1,2o4,2on-2op,2pe,2po,2pq-2pr,2pz-2q1,2q3-2q6,2qd,2qf,2qo-2r5,2r9-2rk,2t7-2ta,2u4-2v4,2v7,2v9-2va,2vd,2vf-2vg,2vi-2vn,2vs,2w0,2w4,2w6,2w8-2w9,2wc,2wq,2wu-2wv,2x1,2x3,2x8,2xa-2xb,2xm-2xn,2xq-2yn,30o,31p-31s,32w,33x,34d,34r-35r,3ba-3bj,3ct-3cv,3m1,3m6-3m7,3mf,3mh,3mm-3mn,3nt,3ny-3nz,3ox,3p2-3p3,3pb,3pd,3pi-3pj,3pz,3rl,3rq-3rr,3tn-3to,3ul-3un,3ve-3vj,3xx-3y7,4gt-4gv,4j5-4jj,4jx,4k5-4kf,4l3-4lb,4lw-4m7,4ml,4mp,4ms-4n3,4pq-4pr,4q2-4q7,4qi-4qn,4qu,4qz-4r1,4r3,4re-4rj,4u0-4u7,4vf-4vj,4xi-4xr,4yl-4yn,4z0-4z3,4zg-4zj,4zl-4zn,50u-50v,511-51b,52k-52n,53e-53j,53v-53x,55o-55p,57j,58d-58e,58q-58v,596-59b,59q-5bz,5e4-5e7,5fh-5fj,5gr-5gt,5h6-5hb,5is-5iz,5ko-5kq,5l6-5l8,5mo-5ov,5pv-5q7,5wn-5x7,652-653,65a-65b,66e-66f,66m-66n,66w,66y,670,672,67y-67z,69h,69x,6ac-6ad,6ak,6b4-6b5,6b9,6bj,6bw-6bz,6cq-6cu,6e8-6en,6eq-6er,6fj,6fx-6fz,6gm-6go,6gr-6hb,6i9-6in,6mi-6mn,73o-73z,753-75r,763-76n,7nh-7nj,7pc,7th-7tj,7u8,7un,7uz,7v1,8jx-8jz,8ka-8ov,8q7,8rj,8vm-8vs,8x2-8xb,8yu-8z2,8z5-8zi,907-90f,90n,90v,913,91b,91j,91r,91z,927,94i-96n,97e,99w-9a7,9g6-9gv,9h8-9hb,9j4,9lj-9lk,9og-9ok,9pq-9ps,9sf-9sh,9tn-9tr,9us-9v3,9wf,a2n,fcm-fcv,vkc-vlr,wi5-wi7,wjr-wjz,wto-wu7,wv4-wv5,wvo-wvv,wwo-wwv,wzc-wzj,x3j,x3m-x3z,x4a-x6h,x7w-x7z,x86-x8f,xa0-xa7,xc5-xcd,xcq-xdd,xdk-xdm,xdo-xdr,xg4-xge,xh9-xhb,xji,xju-xjx,xk0-xkv,xmf-xmn,xn2-xn3,xne-xnf,xoc-xof,xqb-xqy,xr4-xs0,xs7-xs8,xsf-xsg,xsn-xsv,xt3,xtb-xxb,xym-xyn,xyy-xz3,16lg-16lr,16mf-16mi,16nw-16nz,1df2-1df3,1dgu-1dgv,1dju-1dkv,1dl3-1dle,1dlk-1dlo,1dmf,1dml,1dmn,1dmq,1dmt,1dpu-1dqq,1e0w-1e1b,1e34-1e35,1e4o-1e5r,1e66-1e6n,1e6y-1e73,1e7b-1e7j,1e8j,1e93,1e98-1e9b,1e9h,1ed9-1edc,1ein-1eip,1eiw-1eix,1ej4-1ej5,1ejc-1ejd,1ejh-1ejj,1ejr,1ejz-1eke';
const EQ_GUARD_RANGES = 'jd,lc-ld,lv,n4-n5,n7,ok,ou,p1-p6,p8,pa-pc,q1,q4-q8,qd,qh,r0-r2,s5,13t,15c,15f-15g,15o,160,162,17l-18a,18h-18q,19t,1a1-1a3,1a6-1a8,1ab-1ac,1ae-1ag,1ak-1am,1ap,1aw,1b8,1ba,1bd,1bh,1bj,1bl,1bn,1bu-1bv,1by,1c0-1c1,1c5-1c9,1cb-1cc,1cg,1ci-1cj,1kd,1ua,58f,5qa,5rh,5s6,67l,67n,67p,67r,67t,67v,67x,69n,69q,6a1,6a3,6ab,6aj,6ar,6az,6b2-6b3,6bd,6bf,6bh,6bk-6bn,6ck,6g9,6jq,6ju-6jv,6mp,6mr,6y1-6y2,7b6,7fk,7gr,879-87a,97j,99v,9a8-9g5,9hd-9he,9hk-9hl,9ho-9hp,9ll-9lm,9lp-9lq,9lt-9m3,9m5,9m7,9m9,9mb,9md,9mf,9mh,9mj,9ml,9mn,9mp,9mr-9ms,9mu,9mw,9my-9n3,9n6,9n9,9nc,9nf,9ni-9nx,9nz,9o2-9o3,9ob-9oe,9xi,brx,cns,cop,feo,ff1,ffq,ffs,fg2,fg6,fg9,fgf,fh5,fia,fid-fie,fik,fj4,fji,fju,fk0,fl0,fpc,fpi,fpn,fqm,fr3,fu3,fyy,fzb,g1r-g1s,g1x,g25,g2t,g2w-g2x,g2z,g31,g3k,g3m,g46,g4r,g51,g53,g5l,g5o,g64,g66,g68,g6t,g74,g7b,g7r,g89,g8q,gax,gbf,gbn,gcn,gcp,gcy,gda,gdg,gdx,ge1-ge2,get,gev,gey,gfs,gfz,gg1,ggh,ggs,gh5,ghh,ghu,gja,gjn,gjs,gkj,gkl,glr,gm5,gn6,gql,gut,gw7,gwp,gwt,gxs,gyq,gzq,h2g,h5j,h6h,h7j,hfk,hga,hge,hig,hir,hjs,hjz,hkb,hky,hl6,hlh,hlz,hms,hmw,hn5,hn8,ho3,huq,i08,i1c,i2o,i2t,i5j,i5q,i60,i6n,i76,i7s,i7z,i8y,i90-i91,i9a,i9d,ie1,ifk,iii,ijf,ijp,ik1,ike,inm,ino,inu,inz,ip2,iq1-iq2,iqa-iqb,iqh,ir0,ir8,iri,iro,irv,is3,its,iu9,iuh,iur,ivf,iw9,iwd,iwz,iyd,iz6,izg,j2s,j4o,j4x,j60,j7o,j7y,j8g,j8o,j9q,j9s,jci,jcm,jcw,jd4,je6,jec,jee,jez,jih,jin,jir,jjy,jnf,jog,jpg,jrw,jte,jve,jwk,jzj,jzo,k0f,k0m,k1k,k1z,k2f,k2h,k2s,k3d,k3p,k4g,k4i,k4l,k5v,k8k,k94,k9d,kac,kau,kc0,kc4,kco,kd3,kd7,kdk,kem,keu,kfv,kgn,kj7,kk7,kn5,kn9,ko8,kxu,kyb,l3n,l50,l5s,l7m,l87,l89,l9q,l9v,la2,laj,lal,las,laz,lcf,lck,ldg,lfs,lho,lid,ljv,ljy,lkx,lm2,lmf,lor,lp6,lpm,lqy,luk,lve,lvv,lw1,lwb,lxr,lya-lyb,m3v,m4e,m5a,m7f,m8p,ma0,mah,mdl,mem,mha,mhc,mj4,mjf,mju-mjv,mk5-mk6,mkb,mkf,mkn,ml5,ml7,mle,mng,mnj,mo0,mpo,mqy,mt1,mtg,mtj,mtl,muq,mvy,mx2,mx5,mxu,mzt,n01,n0p,n14,n30,n3a,n46,n4o,n4v,n54,n5c,n5n,n6h,n6t,n74,n7v,n82,naa,nbx,nbz,ncy,ne1,nee,nel,nfy,ngf,ngq,nh7,nhj,nhq,nhw,ni9,nk0,nka,nmv,nob,noi,noz,nsb,nt8,ntd,nuy,nv0,nwb,nxm,ny2,ny4,ny6,nyg-nyh,nyo,nyu,nz1-nz2,nz9,nzz,o0d-o0f,o1a,o1k,o1q,o22,o4c,o5c,o6s,o75,o8h,o97,oah,obk,og0,oji,okg,okz,ol7,olu,on2,onq,oo7,ooo,opc,opu,oq7,orf,otc,ou6,ovo,ow9,oxj,oxt,p4m,p4u,p5d,p6a,p6h,p6t,p6y,p7e,p8d,pa9,pad,pak,paq,pbn,pc6,pdb,pdq-pdr,pe1,pe3,pnc,pnn,pns,pnu,pnx,po3,poc,pos,pp7,ppb,pri-prj,prm,prs-prt,put,px2,pxu,q15,q27,q29,q4d,q4p,q53,q9a,q9o,qfh,qgq,qh2,qhe,qi5,qin,qj1,qjg,qjv,qrd,qt6,qvz,qww,qx8,qxv,r0i,r0v,r1d,r20,r2o,r41,r50,r5q,r5y,r63,r6e,r82,r9c,re2,ren,rez,rf6,rfa,rfx,rg8,rge,rgh,ri1,riw,rk0,rka,rp3,rpi,rpk,rpx,rqw,rrx,rsy,rt4,rtf,ruw,rxg,rxs,rzn,s1b,s6j,s7e,s9y,sa2,sag,saj,sbm,sd7,sds,sdx-sdy,sgz,shk,sj6,sjg,sjz,sk1,slq,sn1,sp5,sq2,srd,ss4,ssm,sss,ssv,ssx,svo,sxi,t1g,t3e,tiv,tj4,tkd,tng,tny,tor,tot,tpx,tq0,tq4,tqe,tr7,trq,trs-trt,tsy-tsz,tt4,tti-ttj,tv6,tvs,tw1,tw6,twe,twi,twp,tzf,tzv,u0d,u0j,u0v,u0x,u17,u1k,u2j,u3i,u5k,u6z,u73,u7j,u7w,u94,uc6,uc9,ucs,uep,ui2,ujs,ul4,ulb,umq,un9,unj,unm,unw,uoq,upb,uvr,uzp,v5g,v7e,v8e,vat,vb3,vbr,vbz,vc5,vcr,vcz,vd9-vda,vdd,veh,vel,vf2,vf7,vfk,vgb,vgj,vgq,vgy,vil-vim,vj0,vj3-vj4,1d6o-1de5,1de8,1dea,1ded-1dem,1deo,1deq,1det-1deu,1dey-1df1,1df4-1dgq,1dgw-1dji,1djm-1djo,1djs-1djt,1dlt-1dlv,1dlx,1dlz-1dm1,1dn4-1dpt,1dqr-1dr0,1dr2-1drd,1drw-1drz,1e9s-1ed0,1efz-1ejz';

/** Windows C1_SPACE. Leading whitespace for numbers, `$trim`, and word breaks in `$abbr`/`$caps`. */
const SPACE = new Set([9, 10, 11, 12, 13, 0x20, 0x85, 0xa0, 0x1680, 0x180e, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);

/** Zero of each digit block that WACUP's number parsing accepts (`$left(abc,３)` works). */
const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0xff10];

let tables:
  | { punct: Uint8Array; digit: Uint8Array; upper: Map<number, number>; lower: Map<number, number>; ignorable: Uint8Array; guard: Uint8Array }
  | undefined;

function decodeRanges(src: string): Uint8Array {
  const bits = new Uint8Array(0x10000);
  for (const part of src.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 36));
    for (let c = a; c <= (b ?? a); c++) bits[c] = 1;
  }
  return bits;
}

function decodeRuns(src: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const part of src.split(',')) {
    const [start, count, delta, step] = part.split(' ').map((x) => parseInt(x, 36));
    for (let i = 0; i < count; i++) {
      const c = start + i * (step || 1);
      map.set(c, c + delta);
    }
  }
  return map;
}

function getTables() {
  tables ??= {
    punct: decodeRanges(PUNCT_RANGES),
    digit: decodeRanges(DIGIT_RANGES),
    upper: decodeRuns(UPPER_RUNS),
    lower: decodeRuns(LOWER_RUNS),
    ignorable: decodeRanges(IGNORABLE_RANGES),
    guard: decodeRanges(EQ_GUARD_RANGES),
  };
  return tables;
}

const isSpace = (c: number) => SPACE.has(c);
const isPunct = (c: number) => getTables().punct[c] === 1;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** `$upper`/`$lower` mapping: one code unit to one, plus Deseret (the only cased supplementary script WACUP maps). */
function mapCase(s: string, upper: boolean): string {
  const map = upper ? getTables().upper : getTables().lower;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xd801 && i + 1 < s.length && isLow(s.charCodeAt(i + 1))) {
      const lo = s.charCodeAt(i + 1);
      const shifted = upper ? (lo >= 0xdc28 && lo <= 0xdc4f ? lo - 0x28 : lo) : lo >= 0xdc00 && lo <= 0xdc27 ? lo + 0x28 : lo;
      out += String.fromCharCode(c, shifted);
      i++;
      continue;
    }
    const m = map.get(c);
    out += m === undefined ? s[i] : String.fromCharCode(m);
  }
  return out;
}
const upper = (s: string) => mapCase(s, true);
const lower = (s: string) => mapCase(s, false);

function digitValue(c: number): number {
  if (c < 0x30) return -1;
  for (const z of DIGIT_ZEROS) {
    if (c < z) return -1;
    if (c < z + 10) return c - z;
  }
  return -1;
}

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/** WACUP's integer parsing (`wcstol`): leading whitespace, optional sign, digits; clamped to 32 bits. Winamp 5 reads numbers the same way. */
export function toInt(s: string): number {
  let i = 0;
  while (i < s.length && isSpace(s.charCodeAt(i))) i++;
  let neg = false;
  if (s[i] === '+' || s[i] === '-') {
    neg = s[i] === '-';
    i++;
  }
  let v = 0;
  for (; i < s.length; i++) {
    const d = digitValue(s.charCodeAt(i));
    if (d < 0) break;
    if (v <= INT_MAX) v = v * 10 + d;
  }
  if (neg) return v > 2147483648 ? INT_MIN : -v || 0;
  return v > INT_MAX ? INT_MAX : v;
}

/** ASCII-only case folding: WACUP's `$ifstrequal`, `$decode` and variable names ignore case for A–Z only. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/*
 * Character equality in `$strchr`, `$strrchr` and `$replace`: Windows' CompareString with
 * NORM_IGNOREWIDTH, one character against one. Fullwidth ASCII matches ASCII, U+3000 and U+205F
 * match a space, and characters with no sort weight (soft hyphen, characters Windows' tables don't
 * know) all match each other. Other compatibility variants also match their base characters; those
 * aren't modelled, so a string containing one makes the call unconfirmed (EQ_GUARD_RANGES).
 */
const IGNORABLE = -1;

function eqKey(c: number): number {
  if (getTables().ignorable[c] === 1) return IGNORABLE;
  if (c >= 0xff01 && c <= 0xff5e) return c - 0xfee0;
  if (c === 0x3000 || c === 0x205f) return 0x20;
  return c;
}

/** Case-insensitive key (`$replace` with its fourth argument). */
function eqKeyI(c: number): number {
  const k = eqKey(c);
  if (k === IGNORABLE) return k;
  return eqKey(getTables().lower.get(k) ?? k);
}

/** Characters below U+0250 that match an unmodelled variant (e.g. `.` matches U+2024 ONE DOT LEADER). */
const GUARD_PARTNERS = new Set([0x2b, 0x2e, 0x3b, 0x4b, 0x60, 0xa2, 0xa3, 0xa5, 0xa6, 0xac, 0xb4, 0xb7, 0xc5, 0xc6]);

/** 2: holds an unmodelled variant; 1: holds a character one may match; 0: neither. */
function guardLevel(x: string): number {
  let level = 0;
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (getTables().guard[c] === 1) return 2;
    if (GUARD_PARTNERS.has(c)) level = 1;
  }
  return level;
}

/** Whether comparing these two strings could hit an unmodelled match. */
function unmodelled(x: string, y: string): boolean {
  const a = guardLevel(x);
  const b = guardLevel(y);
  return (a === 2 && b >= 1) || (b === 2 && a >= 1);
}

// ---------------------------------------------------------------------------------------------
// Limits. WACUP has no output cap of its own (the host's buffer truncates the final title), so
// these only keep a pathological format from exhausting the worker.

/** Longest string any function or scope produces here; longer results are cut. */
const MAX_LEN = 1 << 20;
/** Output this long takes WACUP seconds and gigabytes (its harness times out at 2 s): treated as a freeze. */
const FREEZE_LEN = 1 << 28;
/** `$split` loops this many times even when the token runs out; WACUP takes seconds (5·10⁸ hangs, 10⁸ finishes). */
const SPLIT_FREEZE = 1 << 28;
/** `$directory`/`$pathrtrim`/`$pathrpart` repeat their whole loop this many times (10⁸ already hangs). */
const PATH_FREEZE = 1 << 26;
/** WACUP formats its unknown-function and invalid-syntax messages into a 128-character buffer. */
const MESSAGE_LEN = 127;
/** Deeper nesting than this isn't evaluated (WACUP's own limit is its stack size). */
const DEPTH_LIMIT = 500;
/**
 * Total work one evaluation may do, in code units of function output plus one per scope. The
 * freeze checks above catch formats WACUP itself can't finish; this is the backstop for formats
 * that are merely enormous (each call within limits, but far too many of them), so no format can
 * keep the evaluator busy for long. Real formats spend a few thousand.
 */
const WORK_BUDGET = 64 * MAX_LEN;

class Freeze {
  constructor(readonly fn: string) {}
}

/** Thrown when an evaluation spends more than `WORK_BUDGET`. */
class TooHeavy {}

const cap = (s: string) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s);

/** `s` repeated to `total` code units, cut at MAX_LEN. */
function fill(s: string, total: number): string {
  if (total <= 0 || s === '') return '';
  const n = Math.min(total, MAX_LEN);
  return s.repeat(Math.ceil(n / s.length)).slice(0, n);
}

/** `count` characters chosen from `fillStr` counting down: index (count-1+offset) % len … offset % len. */
function countdown(fillStr: string, from: number, to: number): string {
  // Characters fill[i % len] for i = from-1 down to `to`.
  const len = fillStr.length;
  const n = Math.min(from - to, MAX_LEN);
  let out = '';
  for (let k = 0; k < n; k++) out += fillStr[(from - 1 - k) % len];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Path helpers. WACUP has its own versions of the shell path functions; these mirror them.

const isSep = (c: string | undefined) => c === '\\' || c === '/';

function isUnc(s: string): boolean {
  if (!((s[0] === '\\' && s[1] === '\\') || (s[0] === '/' && s[1] === '/'))) return false;
  if ((s[2] === '?' || s[2] === '.') && isSep(s[3])) return false;
  return s.length > 2;
}

function isRoot(s: string): boolean {
  if (s === '') return false;
  if (isSep(s[0]) && s.length === 1) return true;
  if (isUnc(s)) {
    let i = 2;
    while (i < s.length && !isSep(s[i])) i++;
    if (i >= s.length) return false;
    i++;
    while (i < s.length && !isSep(s[i])) i++;
    if (i >= s.length) return true;
    return i + 1 >= s.length;
  }
  if (/^[A-Za-z]:/.test(s)) {
    if (s.length === 2) return true;
    return isSep(s[2]) && s.length === 3;
  }
  return false;
}

/** The file name part, as WACUP's `$filename` finds it (a `:` counts only as a drive colon). */
function fileName(s: string): string {
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (isSep(c) ? i + 1 < s.length : c === ':' && i === 1) start = i + 1;
  }
  return s.slice(start);
}

/** Index just after the extension's dot(s) in `s`, or -1 (the last character can't be the dot). */
function extIndex(s: string): number {
  if (s.length < 2) return -1;
  for (let i = s.length - 2; i >= 0; i--) {
    if (s[i] === '.') {
      let j = i;
      while (s[j] === '.') j++;
      return j < s.length ? j : -1;
    }
    if (isSep(s[i])) return -1;
  }
  return -1;
}

/** What `$directory` and friends strip a buffer down to: after the last `\` or `/`, or a `:` with text after it. */
function stripPath(s: string): string {
  let start = 0;
  for (let i = 0; i < s.length; i++) if (isSep(s[i]) || (s[i] === ':' && i + 1 < s.length)) start = i + 1;
  return s.slice(start);
}

function nextComponent(s: string, p: number): number {
  const t = s.slice(p);
  if (isUnc(t)) {
    let i = 2;
    while (i < t.length && !isSep(t[i])) i++;
    if (i >= t.length) return p + i;
    i++;
    while (i < t.length && !isSep(t[i])) i++;
    return i >= t.length ? p + i : p + i + 1;
  }
  if (isSep(t[0])) return p + 1;
  let i = 0;
  while (i < t.length && !isSep(t[i])) i++;
  return i >= t.length ? p + i : p + i + 1;
}

/** WACUP's `$is_stream`: a URL, but not a zip or CD entry. ASCII case-insensitive prefixes. */
function isStream(s: string): boolean {
  const l = asciiLower(s);
  const ei = extIndex(s);
  if (l.startsWith('cda://') || l.startsWith('**async**cda://') || (ei >= 0 && asciiLower(s.slice(ei, ei + 3)) === 'cda')) return false;
  if (l.startsWith('zip://')) return false;
  if (l.startsWith('http')) {
    const rest = l.slice(4);
    return rest !== '' && ['://', '%3a%2f%2f', 's://', 's%3a%2f%2f'].some((p) => rest.startsWith(p));
  }
  return s.includes('://');
}

// ---------------------------------------------------------------------------------------------
// $abbr

const ROMAN = 'IVXLCDM';

/** Initials, WACUP style; `null` when the result depends on WACUP's memory layout (see below). */
function abbr(a: string[]): string | null {
  const n = a.length;
  if (n === 0 || n > 3) return '';
  const s = a[0];
  if (n >= 2 && s.length < (a[1] ? toInt(a[1]) : 0)) return s;
  const mode = n === 3 && a[2] ? toInt(a[2]) : 0;
  const u: number[] = [];
  for (let i = 0; i < s.length; i++) u.push(s.charCodeAt(i));
  const len = u.length;
  let converted = false;
  let out = '';
  // Output the character at i (a whole surrogate pair); modes 1/2 first convert the rest of the string in place.
  const emit = (i: number): number => {
    if (!converted && (mode === 1 || mode === 2)) {
      const rest = mapCase(String.fromCharCode(...u.slice(i)), mode === 2);
      for (let k = 0; k < rest.length; k++) u[i + k] = rest.charCodeAt(k);
      converted = true;
    }
    const pair = isHigh(u[i]) && i + 1 < len && isLow(u[i + 1]);
    out += pair ? String.fromCharCode(u[i], u[i + 1]) : String.fromCharCode(u[i]);
    return pair ? 2 : 1;
  };
  const wordEnd = (i: number) => {
    let j = i;
    while (j < len && !isSpace(u[j]) && !isPunct(u[j])) j++;
    return j;
  };
  let w = false;
  for (let i = 0; i < len; ) {
    const c = u[i];
    const punct = isPunct(c);
    if (punct) w = false;
    if (w) {
      if (isSpace(c)) w = false;
      i++;
      continue;
    }
    if (isSpace(c)) {
      i++;
      continue;
    }
    // A word starts here. Roman numerals, numbers and "x2" are kept whole.
    const end = wordEnd(i);
    const word = u.slice(i, end);
    const roman = word.length > 0 && word.every((x) => ROMAN.includes(upper(String.fromCharCode(x))));
    if (roman && word.length === 3 && end === len && asciiLower(String.fromCharCode(...word)) === 'mix') {
      // WACUP means to exclude a trailing "mix", but its check compares a pointer that a stray
      // CharUpperW on a stack buffer may have rewritten, so the result changes with unrelated
      // earlier calls in the same format.
      return null;
    }
    const digits = word.length > 0 && word.every((x) => x >= 0x30 && x <= 0x39);
    const xDigit = (c === 0x78 || c === 0x58) && i + 1 < len && getTables().digit[u[i + 1]] === 1;
    if (roman || digits || xDigit) {
      while (i < len && !isSpace(u[i]) && !isPunct(u[i])) i += emit(i);
      w = false;
      continue;
    }
    w = true;
    if ((c === 0x27 && (u[i + 1] === 0x73 || u[i + 1] === 0x74)) || c === 0x2c) {
      i++;
      continue;
    }
    emit(i);
    if (isPunct(u[i])) w = false;
    i++;
  }
  return out;
}

/** `$caps` (lower-case first) / `$caps2`: upper-case the first character of each word. `'` doesn't break words. */
function caps(s: string, lowerFirst: boolean): string {
  if (lowerFirst) s = lower(s);
  let out = '';
  let first = true;
  for (let i = 0; i < s.length; i++) {
    // One code unit at a time: a supplementary letter starting a word stays as it is.
    const c = s.charCodeAt(i);
    const sep = c !== 0x27 && (isSpace(c) || isPunct(c));
    out += !sep && first && !isHigh(c) ? upper(s[i]) : s[i];
    first = sep;
  }
  return out;
}

/** Characters as WACUP's CharNext walk counts them: a surrogate pair is one. */
function chars(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const pair = isHigh(s.charCodeAt(i)) && i + 1 < s.length && isLow(s.charCodeAt(i + 1));
    out.push(pair ? s.slice(i, i + 2) : s[i]);
    if (pair) i++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Functions. Each gets its evaluated arguments (at most 16; `$f()` has one empty argument) and
// returns its output, or `null` when the result can't be confirmed.

interface Ctx {
  vars: Map<string, string>;
  name: string;
}

type Fn = (a: string[], ctx: Ctx) => string | null;

/** Strict-arity functions: a wrong count prints `[INVALID $<canonical>() SYNTAX -> …]`. */
const STRICT: Record<string, [string, number]> = {
  if: ['if', 3],
  if2: ['if2', 2],
  ifgreater: ['ifgreater', 4],
  iflonger: ['iflonger', 4],
  ifstrequal: ['IfStrEqual', 3],
  ifstrequal2: ['IfStrEqual2', 4],
  ifstrnotequal: ['IfStrNotEqual', 3],
};

const strEq = (x: string, y: string) => x !== '' && y !== '' && asciiLower(x) === asciiLower(y);
const int32 = (v: number) => v | 0;

function divide(a: string[], mod: boolean): string {
  let s = toInt(a[0]);
  for (let i = 1; i < a.length; i++) {
    const t = toInt(a[i]);
    if (!t) continue;
    if (s === INT_MIN && t === -1) return '';
    s = mod ? s % t : Math.trunc(s / t);
  }
  return String(s | 0);
}

function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) return -1;
  if (c === INT_MIN) {
    // Windows' MulDiv can't negate this divisor; observed: the rounded quotient, pushed one further from zero.
    const p = BigInt(a) * BigInt(b);
    const abs = p < 0n ? -p : p;
    const q = (abs + 1073741824n) / 2147483648n;
    return Number(p < 0n ? q : -q) + (p < 0n ? 1 : -1);
  }
  if (c < 0) {
    a = -a;
    c = -c;
  }
  const p = BigInt(a) * BigInt(b);
  const half = BigInt(Math.trunc(c / 2));
  const sameSign = (a < 0 && b < 0) || (a >= 0 && b >= 0);
  const r = (sameSign ? p + half : p - half) / BigInt(c);
  return r > 2147483647n || r < -2147483647n ? -1 : Number(r);
}

function formatNum(a: string[], radix: number): string {
  if (a.length !== 2) return '';
  const digits = (toInt(a[0]) >>> 0).toString(radix);
  const w = toInt(a[1]);
  const width = Math.min(Math.abs(w), 64);
  const s = w >= 0 ? digits.padStart(width, '0') : digits.padEnd(width, ' ');
  return s.slice(0, 15);
}

function pad(a: string[], left: boolean, out: boolean, ctx: Ctx): string {
  if (!left) {
    // $pad/$padout only: `*n,fill` repeats fill n times; a lone count gives count - 1 spaces.
    if (a[0][0] === '*') {
      if (a.length !== 2) return a.length === 1 ? '' : padNormal(a, left, out, ctx);
      const n = toInt(a[0].slice(1));
      if (n <= 0) return padNormal(a, left, out, ctx);
      const f = a[1] || ' ';
      if (n * f.length >= FREEZE_LEN) throw new Freeze(ctx.name);
      return fill(f, n * f.length);
    }
    if (a.length === 1) {
      const n = toInt(a[0]) - 1;
      if (n >= FREEZE_LEN) throw new Freeze(ctx.name);
      return fill(' ', n);
    }
  }
  return a.length < 2 ? '' : padNormal(a, left, out, ctx);
}

function padNormal(a: string[], left: boolean, out: boolean, ctx: Ctx): string {
  const s = a[0];
  const n = toInt(a[1]);
  const f = a.length >= 3 && a[2] ? a[2] : ' ';
  if (out) {
    if (n <= 0) return s;
    if (n * (left ? 1 : f.length) >= FREEZE_LEN) throw new Freeze(ctx.name);
    return cap(left ? countdown(f, n, 0) + s : s + fill(f, n * f.length));
  }
  // $pad counts a surrogate pair as one character, $lpad counts code units.
  const len = left ? s.length : chars(s).length;
  if (n <= len) return s;
  if ((n - len) * (left ? 1 : f.length) >= FREEZE_LEN) throw new Freeze(ctx.name);
  return cap(left ? countdown(f, n, len) + s : s + fill(f, (n - len) * f.length));
}

function padcut(a: string[], ctx: Ctx): string {
  if (a.length < 2) return '';
  const s = a[0];
  const n = toInt(a[1]);
  const f = a.length >= 3 && a[2] !== '' ? a[3] ?? '' : ' ';
  if (n < 0) {
    // Read as unsigned: the whole string, then ~4 billion characters of padding.
    if (f !== '') throw new Freeze(ctx.name);
    return s;
  }
  // Counts a surrogate pair as one character.
  const cs = chars(s);
  if (n <= cs.length) return cs.slice(0, n).join('');
  if (f === '') return s;
  if (n - cs.length >= FREEZE_LEN) throw new Freeze(ctx.name);
  return cap(s + countdown(f, n - cs.length, 0));
}

function substr(a: string[]): string {
  if (a.length < 2) return '';
  const s = a[0];
  const from = toInt(a[1]);
  if (from === 0) return '';
  const start = from > 0 ? from - 1 : s.length + from;
  if (start < 0 || start >= s.length) return '';
  // The start is in code units, the length in characters (a surrogate pair is one).
  const n = a.length === 3 ? toInt(a[2]) : 0;
  return n > 0 ? chars(s.slice(start)).slice(0, n).join('') : s.slice(start);
}

function split(a: string[], ctx: Ctx): string {
  if (a.length !== 3) return '';
  const [s, tok] = a;
  const which = toInt(a[2]);
  if (s === '' || tok === '') return '';
  if (which <= 0) {
    const i = s.indexOf(tok);
    return i < 0 ? s : s.slice(0, i);
  }
  if (which >= SPLIT_FREEZE) throw new Freeze(ctx.name);
  let p = 0;
  for (let k = 0; k < which; k++) {
    const i = s.indexOf(tok, p);
    if (i < 0) return '';
    p = i + tok.length;
  }
  return s.slice(p);
}

/** `$replace`: compares character by character (a surrogate pair is one character, compared exactly). */
function replace(a: string[]): string | null {
  if (a.length < 3) return '';
  const [s, find, rep] = a;
  if (find === '') return '';
  if (unmodelled(s, find)) return null;
  // Case-insensitive only when the fourth argument is exactly "1" (not " 1", "01" or "2").
  const key = a.length >= 4 && a[3] === '1' ? eqKeyI : eqKey;
  const sc = chars(s);
  const fc = chars(find);
  const same = (x: string, y: string) => (x.length === 2 || y.length === 2 ? x === y : key(x.charCodeAt(0)) === key(y.charCodeAt(0)));
  let out = '';
  for (let i = 0; i < sc.length; ) {
    let j = 0;
    while (j < fc.length && i + j < sc.length && same(fc[j], sc[i + j])) j++;
    if (j === fc.length) {
      out += rep;
      i += j;
    } else {
      out += sc[i];
      i++;
    }
    if (out.length > MAX_LEN) return out.slice(0, MAX_LEN);
  }
  return out;
}

/** `$strchr`/`$strrchr`: 1-based index of the first/last code unit matching the first unit of a[1]; "0" if none. */
function strchr(a: string[], last: boolean): string | null {
  if (a.length !== 2 || a[1] === '') return '';
  const [s, find] = a;
  if (s === '') return '0';
  if (unmodelled(s, find[0])) return null;
  const k = eqKey(find.charCodeAt(0));
  let hit = -1;
  for (let i = 0; i < s.length; i++) {
    if (eqKey(s.charCodeAt(i)) === k) {
      hit = i;
      if (!last) break;
    }
  }
  return String(hit + 1);
}

/**
 * `$strbetween`: only the first character of each delimiter counts. Text from just after the first
 * start character to the last end character; when the end comes first, WACUP reads the negative
 * length as unsigned and returns the rest of the string (except for a length of exactly -1).
 */
function strbetween(a: string[]): string {
  if (a.length !== 3) return '';
  const [s, start, end] = a;
  if (start === '' || end === '') return '';
  const i = s.indexOf(start[0]);
  const j = s.lastIndexOf(end[0]);
  if (i < 0 || j < 0) return '';
  const len = j - (i + 1);
  return len >= 0 ? s.slice(i + 1, j) : len === -1 ? '' : s.slice(i + 1);
}

function charOf(a: string[]): string {
  if (a.length !== 1) return '';
  const v = toInt(a[0]);
  if (v <= 0) return '';
  if (v < 0xffff) return String.fromCharCode(v);
  const cp = ((v - 0x10000) & 0xfffff) + 0x10000;
  return String.fromCodePoint(cp);
}

/**
 * A path buffer edited in place, as WACUP does: truncation writes a terminator but leaves the
 * old characters after it, and some functions output a length that reaches past the terminator.
 */
class PathBuf {
  raw: string[];
  n: number;

  constructor(s: string, limit = Infinity) {
    this.raw = s.slice(0, limit).split('');
    this.n = this.raw.length;
  }

  get str(): string {
    return this.raw.slice(0, this.n).join('');
  }

  private cut(k: number): void {
    if (k < this.n) {
      this.raw[k] = '\0';
      this.n = k;
    }
  }

  removeFileSpec(): void {
    const s = this.str;
    if (s === '' || isRoot(s)) return;
    let k = s.length - 1;
    while (k >= 0 && !isSep(s[k])) k--;
    this.cut(Math.max(k, 0));
  }

  /** Returns the length WACUP reports, where 2 is reported as 3. */
  removeBackslash(): number {
    const s = this.str;
    if (s !== '' && isSep(s[s.length - 1]) && !isRoot(s.slice(0, -1))) this.cut(this.n - 1);
    return this.n === 2 ? 3 : this.n;
  }

  addBackslash(): void {
    if (this.n > 0 && !isSep(this.raw[this.n - 1])) {
      this.raw[this.n] = '\\';
      this.n++;
      this.raw[this.n] = '\0';
    }
  }

  /** `count` characters of the buffer from `start`, terminators and stale characters included. */
  slice(start: number, count: number): string {
    let out = '';
    for (let i = start; i < start + count; i++) out += this.raw[i] ?? '\0';
    return out;
  }
}

function directory(a: string[], ctx: Ctx): string {
  const n = a.length === 2 ? (a[1] ? toInt(a[1]) : 0) : 1;
  if (n <= 0 || a[0] === '') return '';
  if (n >= PATH_FREEZE) throw new Freeze(ctx.name);
  const b = new PathBuf(a[0], 259);
  for (let k = 0; k < n; k++) {
    const before = b.str;
    b.removeFileSpec();
    b.removeBackslash();
    if (b.str === before) break;
  }
  return b.n === 0 ? '' : stripPath(b.str);
}

/** Level count for the `$path*` functions: default 1, empty 0, negative 0. */
function pathCount(a: string[]): number {
  return Math.max(0, a.length >= 2 ? (a[1] ? toInt(a[1]) : 0) : 1);
}

function pathltrim(a: string[]): string {
  const s = a[0];
  let cut = pathCount(a);
  let p = 0;
  while (p < s.length && cut-- > 0) p = nextComponent(s, p);
  return s.slice(p);
}

function pathlpart(a: string[]): string {
  const s = a[0];
  const b = new PathBuf(s);
  let cut = pathCount(a);
  let p = 0;
  while (p < s.length) {
    if (cut-- === 0) {
      b.raw[p] = '\0';
      b.n = p;
      break;
    }
    p = nextComponent(s, p);
  }
  return b.slice(0, b.removeBackslash());
}

function pathrtrim(a: string[], ctx: Ctx): string {
  const cut = pathCount(a);
  const b = new PathBuf(a[0], 259);
  const copied = b.n;
  if (copied === 0) return '';
  if (cut >= PATH_FREEZE) throw new Freeze(ctx.name);
  let len = 0;
  for (let k = 0; k < cut; k++) {
    const before = b.str;
    b.removeFileSpec();
    len = b.removeBackslash();
    if (b.str === before) break;
  }
  // WACUP outputs (copied length − reported length) characters of the buffer.
  const n = copied - len;
  return n < 0 ? b.str : b.slice(0, n);
}

function pathrpart(a: string[], ctx: Ctx): string | null {
  const cut = pathCount(a);
  const s = a[0];
  if (s === '') return '';
  const b = new PathBuf(s, 259);
  const copied = b.n;
  if (cut >= PATH_FREEZE) throw new Freeze(ctx.name);
  let len = 0;
  for (let k = 0; k < cut; k++) {
    const before = b.str;
    b.removeBackslash();
    b.removeFileSpec();
    b.addBackslash();
    len = b.n;
    if (b.str === before) break;
  }
  // A root such as \\server\share gains a backslash, so WACUP starts past the string and prints whatever memory follows.
  if (len > copied) return null;
  return s.slice(len, copied);
}

function fileExt(a: string[]): string | null {
  const s = a[0];
  if (s.includes('::') || isStreamLike(s)) return null;
  let i = s.length - 1;
  while (i >= 0 && s[i] !== '.' && !isSep(s[i])) i--;
  if (i < 0 || s[i] !== '.') return '';
  // The extension stops at a ':' (as in an NTFS stream name).
  return upper(s.slice(i + 1).split(':')[0].slice(0, 127));
}

/** URL-ish strings take a different, query-string-aware path in WACUP's extension code. */
const isStreamLike = (s: string) => s.includes('://') || /^https?(%3a|s%3a)/i.test(s);

function pathsafe(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 31 || c === 127) continue;
    out += '?*|'.includes(ch) ? '_' : '/\\:'.includes(ch) ? '-' : ch === '"' ? "'" : ch === '<' ? '(' : ch === '>' ? ')' : ch;
  }
  return out;
}

const fromN = (n: number, a: string[]) => (a.length >= n ? a : undefined);

const FUNCS: Record<string, Fn> = {
  if: (a) => (a[0] !== '' ? a[1] : a[2]),
  if2: (a) => (a[0] !== '' ? a[0] : a[1]),
  if3: (a) => a.slice(0, -1).find((x) => x !== '') ?? a[a.length - 1],
  decode: (a) => {
    if (a.length < 2) return '';
    for (let s = 1; s + 1 < a.length; s += 2) if (strEq(a[0], a[s])) return a[s + 1];
    return a[a.length - 1];
  },
  ifgreater: (a) => (toInt(a[0]) > toInt(a[1]) ? a[2] : a[3]),
  iflonger: (a) => (a[0].length > toInt(a[1]) ? a[2] : a[3]),
  ifstrequal: (a) => (strEq(a[0], a[1]) ? a[2] : ''),
  ifstrequal2: (a) => (strEq(a[0], a[1]) ? a[2] : a[3]),
  ifstrnotequal: (a) => ((a[0] !== '' || a[1] !== '') && !strEq(a[0], a[1]) ? a[2] : ''),
  select: (a) => a[toInt(a[0]) >>> 0] ?? '',

  add: (a) => String(a.reduce((s, x) => int32(s + toInt(x)), 0)),
  sub: (a) => String(a.slice(1).reduce((s, x) => int32(s - toInt(x)), toInt(a[0]))),
  mul: (a) => String(a.reduce((s, x) => (x === '' ? s : Math.imul(s, toInt(x))), 1)),
  div: (a) => divide(a, false),
  mod: (a) => divide(a, true),
  muldiv: (a) => (a.length === 3 ? String(mulDiv(toInt(a[0]), toInt(a[1]), toInt(a[2]))) : ''),
  min: (a) => String(Math.min(...a.map(toInt))),
  max: (a) => String(Math.max(...a.map(toInt))),

  lower: (a) => lower(a[0]),
  upper: (a) => upper(a[0]),
  replace: (a) => replace(a),
  left: (a) => (fromN(2, a) ? a[0].slice(0, Math.max(0, toInt(a[1]))) : ''),
  cut: (a) => {
    if (a.length < 2) return '';
    const n = toInt(a[1]);
    return n >= 0 ? a[0].slice(0, n) : a[0].slice(0, Math.max(0, a[0].length + n));
  },
  right: (a) => {
    if (a.length < 2) return '';
    const n = toInt(a[1]);
    return n <= 0 || n > a[0].length ? '' : a[0].slice(a[0].length - n);
  },
  len: (a) => String(a[0].length),
  substr: (a) => substr(a),
  // Exactly two arguments, both non-empty; "0" when not found.
  strstr: (a) => (a.length !== 2 || a[0] === '' || a[1] === '' ? '' : String(a[0].indexOf(a[1]) + 1)),
  strchr: (a) => strchr(a, false),
  strlchr: (a) => strchr(a, false),
  strrchr: (a) => strchr(a, true),
  strbetween: (a) => strbetween(a),
  shortest: (a) => a.reduce((m, x) => (x.length < m.length ? x : m), a[0]),
  longest: (a) => a.reduce((m, x) => (x.length > m.length ? x : m), ''),
  abbr: (a) => abbr(a),
  padcut: (a, ctx) => padcut(a, ctx),
  pad: (a, ctx) => pad(a, false, false, ctx),
  lpad: (a, ctx) => pad(a, true, false, ctx),
  padout: (a, ctx) => pad(a, false, true, ctx),
  lpadout: (a, ctx) => pad(a, true, true, ctx),
  trim: (a) => {
    const s = a[0];
    let i = 0;
    let j = s.length;
    while (i < j && isSpace(s.charCodeAt(i))) i++;
    while (j > i && isSpace(s.charCodeAt(j - 1))) j--;
    return s.slice(i, j);
  },
  repeat: (a, ctx) => {
    if (a.length !== 2) return '';
    const n = toInt(a[1]);
    if (n <= 0 || a[0] === '') return '';
    if (n * a[0].length >= FREEZE_LEN) throw new Freeze(ctx.name);
    return fill(a[0], n * a[0].length);
  },
  caps: (a) => caps(a[0], true),
  caps2: (a) => caps(a[0], false),
  split: (a, ctx) => split(a, ctx),
  hex: (a) => formatNum(a, 16),
  num: (a) => formatNum(a, 10),
  dec: (a) => formatNum(a, 10),
  char: (a) => charOf(a),
  leftbracket: () => '(',
  rightbracket: () => ')',
  crlf: () => '\r\n',
  tab: (a, ctx) => {
    const n = a.length === 1 ? toInt(a[0]) : 1;
    if (n >= FREEZE_LEN) throw new Freeze(ctx.name);
    return n > 0 ? fill('\t', n) : '';
  },
  null: () => '',

  filepart: (a) => {
    const f = fileName(a[0]);
    const e = extIndex(f);
    return e > 0 ? f.slice(0, e - 1) : '';
  },
  filename: (a) => fileName(a[0]),
  fileext: (a) => fileExt(a),
  ext: (a) => fileExt(a),
  directory: (a, ctx) => directory(a, ctx),
  pathltrim: (a) => pathltrim(a),
  pathlpart: (a) => pathlpart(a),
  pathrtrim: (a, ctx) => pathrtrim(a, ctx),
  pathrpart: (a, ctx) => pathrpart(a, ctx),
  pathsafe: (a) => pathsafe(a[0]),

  puts: (a, ctx) => {
    if (a.length >= 2 && a[0] !== '' && a[1] !== '') ctx.vars.set(asciiLower(a[0]), a[1]);
    return '';
  },
  put: (a, ctx) => {
    if (a.length < 2 || a[0] === '' || a[1] === '') return '';
    ctx.vars.set(asciiLower(a[0]), a[1]);
    return a[1];
  },
  get: (a, ctx) => (a[0] === '' ? '' : ctx.vars.get(asciiLower(a[0])) ?? ''),

  // Local time, not zero-padded (WACUP converts the number with no width).
  systime_year: () => String(new Date().getFullYear()),
  systime_month: () => String(new Date().getMonth() + 1),
  systime_day: () => String(new Date().getDate()),
  systime_hour: () => String(new Date().getHours()),
  systime_minute: () => String(new Date().getMinutes()),
  systime_second: () => String(new Date().getSeconds()),
  is_stream: (a) => (isStream(a[0]) ? '1' : ''),
  // These read the host's Media Library / file info, which the evaluator can't see.
  rating: () => null,
  bitdepth: () => null,
};

/** Functions that read an argument by its tracked length, so an embedded terminator is harmless. */
const LENGTH_SAFE = new Set(['len']);

// ---------------------------------------------------------------------------------------------
// The walk.

interface Scope {
  text: string;
  found: number;
}

interface Scan {
  ok: boolean;
  pos: number;
}

/** Same balanced scan as the parser's: quotes hide brackets, parens and brackets counted separately. */
function skip(s: string, p: number, end: number, stops: string): Scan {
  let paren = 0;
  let bracket = 0;
  while (p < end) {
    const c = s[p];
    if (paren === 0 && bracket === 0 && stops.includes(c)) break;
    if (c === "'") {
      p++;
      while (p < end && s[p] !== "'") p++;
      if (p >= end) return { ok: false, pos: p };
    } else if (c === '(') {
      paren++;
    } else if (c === ')') {
      if (--paren < 0) return { ok: false, pos: p };
    } else if (c === '[') {
      bracket++;
    } else if (c === ']') {
      if (--bracket < 0) return { ok: false, pos: p };
    }
    p++;
  }
  return { ok: p < end && paren === 0 && bracket === 0, pos: p };
}

/** WACUP reads at most 32 characters of a field or function name. */
const NAME_LIMIT = 32;

/**
 * Where a `%field%` or `$name(` ends, for the `%` or `$` at p: the first `end` character within
 * the name limit. With none there, the character just past the limit is taken as the end, whatever
 * it is. -1 when the scope ends first.
 */
function nameEnd(s: string, p: number, to: number, end: string): number {
  for (let i = p + 2; i <= p + NAME_LIMIT; i++) {
    if (i >= to) return -1;
    if (s[i] === end) return i;
  }
  return p + NAME_LIMIT + 1 < to ? p + NAME_LIMIT + 1 : -1;
}

const syntaxError = (code: number) =>
  code === 0 ? '[INTERNAL ERROR]' : code === 2 ? '[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]' : `[SYNTAX ERROR IN FORMATTING STRING (${code})]`;

class Evaluator {
  vars = new Map<string, string>();
  unsure = new Set<string>();
  freezeAt?: { start: number; end: number };
  private work = 0;

  constructor(
    private s: string,
    private fields: Record<string, string>,
  ) {}

  /** Spend `n` units of the work budget; past it the evaluation stops as `tooHeavy`. */
  private spend(n: number): void {
    this.work += n;
    if (this.work > WORK_BUDGET) throw new TooHeavy();
  }

  run(from: number, to: number, depth: number): Scope {
    this.spend(1);
    const s = this.s;
    let out = '';
    let found = 0;
    const fail = (code: number): Scope => ({ text: syntaxError(code), found });
    let p = from;
    while (p < to) {
      const c = s[p];
      if (c === '%') {
        if (p + 1 < to && s[p + 1] === '%') {
          out += '%';
          p += 2;
          continue;
        }
        const q = nameEnd(s, p, to, '%');
        if (q < 0) return fail(2);
        const key = s.slice(p + 1, q).toLowerCase();
        const v = Object.prototype.hasOwnProperty.call(this.fields, key) ? this.fields[key] : undefined;
        if (typeof v === 'string' && v !== '') {
          found++;
          out += v;
        }
        p = q + 1;
      } else if (c === '$') {
        if (p + 1 < to && s[p + 1] === '$') {
          out += '$';
          p += 2;
          continue;
        }
        // The character at q acts as the '(' even when the name search hit its limit.
        const q = nameEnd(s, p, to, '(');
        if (q < 0) return fail(3);
        const close = skip(s, q + 1, to, ')');
        if (!close.ok) return fail(4);
        const s2 = close.pos;
        const name = s.slice(p + 1, q);
        if (depth >= DEPTH_LIMIT) {
          this.unsure.add(name.toLowerCase());
          out += '?';
          p = s2 + 1;
          continue;
        }
        const args: string[] = [];
        let a = q + 1;
        while (a <= s2 && args.length < MAX_ARGS) {
          const arg = skip(s, a, to, ',)');
          if (!arg.ok) return fail(6);
          if (arg.pos > s2) return fail(0);
          const r = this.run(a, arg.pos, depth + 1);
          found += r.found;
          args.push(r.text);
          a = arg.pos + 1;
        }
        const key = name.toLowerCase();
        const fn = Object.prototype.hasOwnProperty.call(FUNCS, key) ? FUNCS[key] : undefined;
        const strict = STRICT[key];
        if (!fn || !/^[\x21-\x7e]+$/.test(name)) {
          out = `[UNKNOWN FUNCTION -> $${s.slice(p + 1, to)}]`.slice(0, MESSAGE_LEN);
        } else if (strict && args.length !== strict[1]) {
          out = `[INVALID $${strict[0]}() SYNTAX -> ${s.slice(p + 1, to)}]`.slice(0, MESSAGE_LEN);
        } else if (!LENGTH_SAFE.has(key) && args.some((x) => x.includes('\0'))) {
          this.unsure.add(key);
          out += '?';
        } else {
          let r: string | null;
          try {
            r = fn(args, { vars: this.vars, name: key });
          } catch (e) {
            if (e instanceof Freeze && !this.freezeAt) this.freezeAt = { start: p, end: s2 + 1 };
            throw e;
          }
          if (r === null) {
            this.unsure.add(key);
            out += '?';
          } else {
            this.spend(r.length + 1);
            out += r;
          }
        }
        p = s2 + 1;
      } else if (c === "'") {
        if (p + 1 < to && s[p + 1] === "'") {
          out += "'";
          p += 2;
          continue;
        }
        const q = s.indexOf("'", p + 2);
        if (q < 0 || q >= to) return fail(7);
        out += s.slice(p + 1, q);
        p = q + 1;
      } else if (c === '[') {
        const close = skip(s, p + 1, to, ']');
        if (!close.ok) return fail(8);
        const r = depth >= DEPTH_LIMIT ? { text: '', found: 0 } : this.run(p + 1, close.pos, depth + 1);
        if (r.found) {
          out += r.text;
          found += r.found;
        }
        p = close.pos + 1;
      } else if (c === ']' || c === '(' || c === ')') {
        return fail(9);
      } else {
        out += c;
        p++;
      }
      if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN);
    }
    return { text: out, found };
  }
}

/** `fields` maps lower-case field names to values; a missing or empty value means the field didn't resolve. */
export function evaluate(format: string, fields: Record<string, string>): EvalResult {
  const { error } = parse(format);
  const ev = new Evaluator(format, fields);
  try {
    const { text } = ev.run(0, format.length, 0);
    const nul = text.indexOf('\0');
    const result: EvalResult = { text: nul < 0 ? text : text.slice(0, nul), unsure: [...ev.unsure].sort() };
    if (error) result.error = error;
    return result;
  } catch (e) {
    if (e instanceof TooHeavy) {
      const result: EvalResult = { text: '', unsure: [...ev.unsure].sort(), tooHeavy: true };
      if (error) result.error = error;
      return result;
    }
    if (!(e instanceof Freeze)) throw e;
    const result: EvalResult = { text: '', unsure: [...ev.unsure].sort(), freeze: { fn: e.fn, ...(ev.freezeAt ?? { start: 0, end: format.length }) } };
    if (error) result.error = error;
    return result;
  }
}
