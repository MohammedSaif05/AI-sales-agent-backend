import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentBusinessId } from '../../common/decorators/current-business.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('Customer Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ApiOperation({
    summary: 'Add Customer Manually',
    description:
      'Creates a customer record with normalized phone number and default marketing communication preferences.',
  })
  @ApiResponse({ status: 201, description: 'Customer created successfully' })
  @ApiResponse({
    status: 409,
    description: 'Customer with this mobile number already exists in business',
  })
  async create(
    @CurrentBusinessId() businessId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(businessId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List / Search Customers',
    description:
      'Returns a paginated list of customers for the store with search and filter capabilities.',
  })
  @ApiResponse({ status: 200, description: 'Paginated customer list' })
  async findAll(
    @CurrentBusinessId() businessId: string,
    @Query() query: CustomerQueryDto,
  ) {
    return this.customersService.findAll(businessId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Customer Details',
    description:
      'Retrieves single customer information and communication preferences.',
  })
  @ApiResponse({ status: 200, description: 'Customer details' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async findOne(
    @CurrentBusinessId() businessId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.findOne(businessId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Customer Information',
    description:
      'Updates customer contact details, profile, or communication preferences.',
  })
  @ApiResponse({ status: 200, description: 'Customer updated successfully' })
  @ApiResponse({ status: 409, description: 'Updated phone number conflicts with another customer' })
  async update(
    @CurrentBusinessId() businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(businessId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-Delete Customer',
    description:
      'Marks the customer as deleted (sets deletedAt) without breaking historic references.',
  })
  @ApiResponse({ status: 200, description: 'Customer soft-deleted successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async remove(
    @CurrentBusinessId() businessId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.softDelete(businessId, id);
  }
}
