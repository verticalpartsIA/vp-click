import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Padrão "Notification banner" do GOV.UK Design System — para avisos
// importantes que precisam permanecer visíveis (não somem sozinhos como um
// toast), sem flutuar por cima de outros controles da tela. Diferente do
// Warning text (abaixo): o banner é posicionado no fluxo normal do layout,
// empurra o conteúdo pra baixo, e tem um cabeçalho com rótulo próprio
// ("Importante"/"Sucesso") separado da mensagem.
//
// `role="region"` (padrão) não interrompe o usuário; `role="alert"` (variant
// "success") anuncia imediatamente — reservar pra confirmações de uma ação
// que o próprio usuário acabou de completar, nunca pra avisos passivos.
interface NotificationBannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: string;
  variant?: "important" | "success";
  onDismiss?: () => void;
}

export const NotificationBanner = React.forwardRef<HTMLDivElement, NotificationBannerProps>(
  ({ title, variant = "important", onDismiss, className, children, ...props }, ref) => {
    const titleId = React.useId();
    const isSuccess = variant === "success";
    return (
      <div
        ref={ref}
        role={isSuccess ? "alert" : "region"}
        aria-labelledby={titleId}
        className={cn("border-b shadow-sm", isSuccess ? "bg-green-50 border-green-200" : "bg-blue-50 border-blue-200", className)}
        {...props}
      >
        <div className={cn("px-4 py-1.5 text-xs font-bold text-white uppercase tracking-wide", isSuccess ? "bg-green-700" : "bg-blue-800")}>
          <span id={titleId}>{title ?? (isSuccess ? "Sucesso" : "Importante")}</span>
        </div>
        <div className="px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="text-sm text-gray-800 flex-1 min-w-0">{children}</div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Fechar aviso"
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-black/5 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  },
);
NotificationBanner.displayName = "NotificationBanner";
