import type { ApiFocus } from './contrat';
import { creerApiHttp } from './http';
import { creerApiSimulee } from './simule';

export const API_SIMULEE = import.meta.env.VITE_API_SIMULEE === '1';

export function creerApi(jeton: string): ApiFocus {
  return API_SIMULEE ? creerApiSimulee() : creerApiHttp(jeton);
}
