import { test, expect } from '../Fixtures/fixture-use';

test.describe('Code and Prompt', () => {
  const test_data = [
  { ticket: 'JIRA-123', tcs: 'TE-T1' }
];
for (const current of test_data) {

  test(`Code and Prompt. ${JSON.stringify(current)}`,
    async ({ MyLLM }) => {
      test.setTimeout(5 * 60 * 1000);
      const searchTerm = 'polo shirts';
      let url: string;

      // Start debugging script here
      await MyLLM.page.goto("https://www.automationexercise.com/products");
      await MyLLM.LLM.runPrompt(`Search for ${searchTerm}. Close dialog if vignette pops up`);

      url = (await MyLLM.page.url()).toLowerCase().replace(/%20/g, ' ');
      await expect(url).toContain(`search=${searchTerm}`);
    });
}
});

test.describe('Test Case 1: Register User', () => {
  const test_data = [
    { ticket: 'JIRA-123', tcs: 'TE-T11' }
  ];

  for (const current of test_data) {
    test(`Test Case 1: Register User. ${JSON.stringify(current)}`,
      async ({ MyLLM }) => {
        
        test.setTimeout(10 * 60 * 1000);
        const user = MyLLM.TestData.registrationUser();

        // 1. Launch browser
        // 2. Navigate to url http://automationexercise.com
        await MyLLM.page.goto('http://automationexercise.com');

        // 3. Verify that home page is visible successfully
        await MyLLM.LLM.runPrompt('Verify that the home page is visible successfully.');

        // 4. Click on Signup / Login button
        await MyLLM.LLM.runPrompt("Click on the 'Signup / Login' button.");

        // 5. Verify 'New User Signup!' is visible
        await MyLLM.LLM.runPrompt("Verify that 'New User Signup!' is visible.");

        // 6. Enter name and email address
        await MyLLM.LLM.runPrompt(`Enter name '${user.name}' and email '${user.email}' in the signup form.`);

        // 7. Click 'Signup' button
        await MyLLM.LLM.runPrompt("Click the 'Signup' button.");

        // 8. Verify that 'ENTER ACCOUNT INFORMATION' is visible
        await MyLLM.LLM.runPrompt("Verify that 'ENTER ACCOUNT INFORMATION' is visible.");

        // 9. Fill details: Title, Name, Email, Password, Date of birth
        await MyLLM.LLM.runPrompt(`Fill in the account details: title, name '${user.name}', email '${user.email}', password '${user.password}', and date of birth.`);

        // 10. Select checkbox 'Sign up for our newsletter!'
        await MyLLM.LLM.runPrompt("Select the checkbox for 'Sign up for our newsletter!'.");

        // 11. Select checkbox 'Receive special offers from our partners!'
        await MyLLM.LLM.runPrompt("Select the checkbox for 'Receive special offers from our partners!'.");

        // 12. Fill details: First name, Last name, Company, Address, Address2, Country, State, City, Zipcode, Mobile Number
        await MyLLM.LLM.runPrompt("Fill in the address details: First name 'Test', Last name 'User', Company 'Example Labs', Address '123 Main St', Address2 'Suite 456', Country 'United States', State 'California', City 'Los Angeles', Zipcode '90001', Mobile Number '1234567890'.");

        // 13. Click 'Create Account button'
        await MyLLM.LLM.runPrompt("Click the 'Create Account' button.");

        // 14. Verify that 'ACCOUNT CREATED!' is visible
        await MyLLM.LLM.runPrompt("Verify that 'ACCOUNT CREATED!' is visible.");

        // 15. Click 'Continue' button
        await MyLLM.LLM.runPrompt("Click the 'Continue' button.");

        // 16. Verify that 'Logged in as username' is visible
        await MyLLM.LLM.runPrompt("Verify that 'Logged in as username' is visible.");
        
        // 17. Click 'Delete Account' button
        await MyLLM.LLM.runPrompt("Click the 'Delete Account' button.");
        await MyLLM.LLM.runPrompt("Verify that 'ACCOUNT DELETED!' is visible and then click the 'Continue' button.");
      });
  }
});