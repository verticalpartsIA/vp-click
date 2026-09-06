import * as React from "react";
import { cn } from "@/lib/utils";

// Padrão "Warning text" do GOV.UK Design System — aviso pontual dentro do
// conteúdo da página (ex.: "esta ação não pode ser desfeita"), diferente do
// Notification banner (que é persistente e vive fora do fluxo de conteúdo).
// `role="text"` (suportado por Safari/VoiceOver, ignorado sem efeito
// colateral nos demais) evita que o leitor de tela anuncie o ícone "!" e o
// texto como dois elementos desconectados.
export const WarningText = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} role="text" className={cn("flex items-start gap-2 text-sm font-medium text-amber-800", className)} {...props}>
      <span aria-hidden="true" className="text-lg font-bold leading-5 shrink-0">!</span>
      <span>
        <span className="sr-only">Aviso: </span>
        {children}
      </span>
    </div>
  ),
);
WarningText.displayName = "WarningText";
