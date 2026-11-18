/** Where each role lands after signing in. */
export const homeFor = (role: string): string =>
  role === 'registrar' ? '/registrar' : role === 'doctor' ? '/doctor' : role === 'manager' ? '/manager/report' : '/';
