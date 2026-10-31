export const CONTRACT_ADDRESSES = {
  RentalAgreementFactory: (typeof import.meta !== "undefined" && import.meta.env?.VITE_FACTORY_ADDRESS) || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  SampleAgreement: (typeof import.meta !== "undefined" && import.meta.env?.VITE_SAMPLE_AGREEMENT_ADDRESS) || "0xa16E02E87b7454126E5E10d957A927A7F5B5d2be"
};
