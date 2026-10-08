import { applicationMock } from '../data/mock/applications.js'
import { createService } from './serviceFactory.js'
export const applicationService=createService({endpoint:'/api/applications',mock:applicationMock,collection:true})
