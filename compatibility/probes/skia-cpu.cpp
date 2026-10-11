// Temporary compatibility probe; compile against pinned upstream Skia.
#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRect.h"
#include "include/core/SkSurface.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>

int main() {
 constexpr int w=320,h=180;
 auto info=SkImageInfo::Make(w,h,kRGBA_8888_SkColorType,kPremul_SkAlphaType);
 auto surface=SkSurfaces::Raster(info);
 if(!surface) { std::fprintf(stderr,"Failed to create Skia raster surface\n"); return 2; }
 auto* canvas=surface->getCanvas();
 canvas->clear(SK_ColorTRANSPARENT);
 SkPaint paint;
 paint.setColor(SK_ColorMAGENTA);
 paint.setAntiAlias(true);
 auto start=std::chrono::steady_clock::now();
 canvas->drawRect(SkRect::MakeLTRB(50,20,250,160),paint);
 auto ns=std::chrono::duration_cast<std::chrono::nanoseconds>(
    std::chrono::steady_clock::now()-start).count();
 SkPixmap pm;
 if(!surface->peekPixels(&pm)) { std::fprintf(stderr,"Skia raster surface has no pixmap\n"); return 2; }
 auto* rgba=static_cast<const unsigned char*>(pm.addr(100,80));
 auto* bg=static_cast<const unsigned char*>(pm.addr(0,0));
 if(rgba[0]!=255 || rgba[1]!=0 || rgba[2]!=255 || rgba[3]!=255 || bg[3]!=0)
    { std::fprintf(stderr,"Unexpected Skia raster pixel content\n"); return 2; }
 const char* name=std::getenv("PFX_OUTPUT");
 if(!name) name="skia-cpu.ppm";
 std::ofstream file(name,std::ios::binary);
 file<<"P6\n"<<w<<" "<<h<<"\n255\n";
 for(int y=0;y<h;y++)for(int x=0;x<w;x++){
   auto* px=static_cast<const unsigned char*>(pm.addr(x,y));
   file.write(reinterpret_cast<const char*>(px),3);
 }
 if(!file) { std::fprintf(stderr,"Failed to write PPM output\n"); return 2; }
 std::cout<<"PFX_PROBE_RESULT renderer=skia_cpu width="<<w<<" height="<<h
          <<" render_ns="<<ns<<" artifact="<<name<<"\n";
}
