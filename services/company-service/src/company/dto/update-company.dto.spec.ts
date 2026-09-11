import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCompanyDto } from './update-company.dto';

describe('Company optimistic update DTO', () => {
  it('accepts the initial aggregate version zero', async () => {
    expect(await validate(plainToInstance(UpdateCompanyDto, {
      expectedVersion: 0, description: 'Updated company description',
    }))).toHaveLength(0);
  });

  it.each([undefined, null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expectedVersion %p', async (expectedVersion) => {
      const errors = await validate(plainToInstance(UpdateCompanyDto, {
        expectedVersion, description: 'Updated company description',
      }));
      expect(errors.map(({ property }) => property)).toContain('expectedVersion');
    },
  );
});
