export interface RegistrationUserData {
  name: string;
  email: string;
  password: string;
}

export class TestData {
  registrationUser(): RegistrationUserData {
    return {
      name: 'Test User',
      email: `test.${Date.now()}@example.com`,
      password: 'Password123!',
    };
  }
}