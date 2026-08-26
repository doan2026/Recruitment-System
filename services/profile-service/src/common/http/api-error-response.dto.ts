import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'Request validation failed' })
  message!: string;

  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      'Machine-readable context when safe; otherwise null',
    example: null,
  })
  details!: unknown;
}
