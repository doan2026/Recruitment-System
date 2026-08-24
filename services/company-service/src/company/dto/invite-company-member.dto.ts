import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';

export class InviteCompanyMemberDto {
  @ApiProperty({ format: 'email', maxLength: 320 })
  @Trim()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
