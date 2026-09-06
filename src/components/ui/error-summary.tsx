import { useEffect, useRef } from 'react';

// Padrão "Error summary" do GOV.UK Design System: em vez de um toast que some
// sozinho e não aponta pra nenhum campo, lista todos os erros de validação
// num único bloco focável (o foco vai pra cá quando os erros aparecem, como
// um leitor de tela faria pra qualquer role="alert" novo) com um link por
// erro que leva — e move o foco de verdade — direto pro campo problemático.
export function ErrorSummary({ errors }: { errors: { id: string; message: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors]);

  if (errors.length === 0) return null;

  return (
    <div ref={ref} role="alert" tabIndex={-1} className="rounded-lg border-2 border-red-600 bg-red-50 p-4 outline-none focus:ring-2 focus:ring-red-300">
      <h4 className="text-sm font-bold text-red-800 mb-2">
        {errors.length === 1 ? 'Há um problema' : `Há ${errors.length} problemas`}
      </h4>
      <ul className="space-y-1 list-none">
        {errors.map((err) => (
          <li key={err.id}>
            <a
              href={`#${err.id}`}
              className="text-sm text-red-700 underline hover:text-red-900"
              onClick={(e) => { e.preventDefault(); document.getElementById(err.id)?.focus(); }}
            >
              {err.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
