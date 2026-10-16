import dotenv from 'dotenv';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { backfillStripeFees } from '../src/utils/backfillStripeFees';

dotenv.config();

// Uso:
//   npm run backfill:stripe-fees            → modo prueba, no escribe nada
//   npm run backfill:stripe-fees -- --apply → escribe en Supabase
//
// Requiere en el .env local: STRIPE_SECRET_KEY, SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY. La service role key es solo para correr este
// script en tu máquina; no se agrega a las variables del servidor.
const main = async () => {
    const apply = process.argv.includes('--apply');
    const missing = ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
        .filter((key) => !process.env[key]);
    if (missing.length > 0) {
        console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
        process.exit(1);
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const supabase = createClient(
        process.env.SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { persistSession: false } },
    );

    console.log(apply ? 'Modo REAL: se escribirá en payments.' : 'Modo PRUEBA: no se escribe nada (usa --apply).');
    const result = await backfillStripeFees(supabase, stripe, { apply });
    console.log(
        `\nRevisados: ${result.scanned} · ${apply ? 'Actualizados' : 'Se actualizarían'}: ${result.updated} · ` +
        `Sin datos en Stripe: ${result.skipped} · Errores: ${result.failed}`,
    );
    if (result.failed > 0) process.exit(1);
};

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
