import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';

export enum CompanyVerificationDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class VerifyCompanyDto {
  @ApiProperty({ enum: CompanyVerificationDecision })
  @IsEnum(CompanyVerificationDecision)
  decision!: CompanyVerificationDecision;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Required when decision is REJECT; omitted for APPROVE',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
