/**
 * Version du contrat moteur ↔ interface que cette interface sait parler (apex/integration/RULES.md §4.1).
 * Envoyée dans chaque requête de tranchage : le moteur refuse (code 2) une version différente.
 * Producteur : le moteur (`config/schema.py`, `APEX_CONTRACT_VERSION`, journal `CONTRACT_CHANGES.md`).
 */
export const APEX_CONTRACT_VERSION = 2;
