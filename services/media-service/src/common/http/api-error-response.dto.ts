import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'FILE_NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'The file was not found' })
  message!: string;

  @ApiProperty({ nullable: true })
  details!: unknown;
}
