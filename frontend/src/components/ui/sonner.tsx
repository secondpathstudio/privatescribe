import { CircleCheck, TriangleAlert } from "lucide-react";
import { Toaster as Sonner } from "sonner";

/**
 * App-wide toast host. Mounted once at the app root (see main.tsx); other
 * components raise toasts with `toast.success` / `toast.error` imported
 * directly from "sonner".
 *
 * Styled to the app's neobrutalist "neo" look — flat colour fill, thick
 * black border, hard offset shadow, square corners, bold uppercase text.
 * `unstyled` drops sonner's own styles so these classes fully define it.
 * Custom black icons replace sonner's coloured ones, which would vanish
 * against the matching red/green fill.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      duration={6000}
      icons={{
        success: <CircleCheck className="size-5" strokeWidth={2.5} />,
        error: <TriangleAlert className="size-5" strokeWidth={2.5} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 border-4 border-black p-4 " +
            "font-bold text-black shadow-[8px_8px_0px_0px_#000000]",
          title: "text-sm font-bold uppercase tracking-wide",
          icon: "shrink-0",
          error: "bg-red-400",
          success: "bg-green-400",
          default: "bg-white",
        },
      }}
    />
  );
}
