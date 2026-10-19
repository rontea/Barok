import { pollinationsClient } from '../../src/pollinations/client.ts';
import { CrewCoordinator } from '../../src/agents/crew.ts';

async function runCrewApiTest() {
  console.log('=== Starting Live Crew API Verification ===');

  const testTask = `Create a temporary folder named "crew_temp_test" if it does not exist. Inside it, assign a coder agent to write a file named "crew_api.txt" with the content "Crew API test working". Finally, verify using bash that the file exists and its contents are correct.`;
  const crew = new CrewCoordinator(pollinationsClient);
  const result = await crew.orchestrateComplexTask(testTask);

  if (!result) throw new Error('The live crew API smoke test returned no result.');
  console.log('\n=== Live Crew API Test Completed ===');
  console.log(`Final Result: ${result}`);
}

runCrewApiTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
