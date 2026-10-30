export const defaultSettings = {
  customers: ['Alstom', 'Indian Railways', 'ONGC', 'BHEL'],
  departments: ['QA', 'Production', 'Sales', 'Design'],
  metricsTargets: { responseTime: 24, mttc: 48, rcaTime: 15, mttr: 30 },
  uploadConfig: {
    D0_Evidence: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D2_Problem: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: false, size: 4, unit: 'MB' }, EXCEL: { enabled: false, size: 4, unit: 'MB' } },
    D3_Actions: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D4_Occ: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D4_Esc: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D5_Actions: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D6_Actions: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D7_Actions: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D8_Rec: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } },
    D8_CONQ: { IMAGE: { enabled: true, size: 4, unit: 'MB' }, PDF: { enabled: true, size: 4, unit: 'MB' }, EXCEL: { enabled: true, size: 4, unit: 'MB' } }
  }
};
