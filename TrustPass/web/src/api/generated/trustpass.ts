import {
  useMutation,
  useQuery
} from '@tanstack/react-query';
import type {
  DataTag,
  DefinedInitialDataOptions,
  DefinedUseQueryResult,
  MutationFunction,
  QueryClient,
  QueryFunction,
  QueryKey,
  UndefinedInitialDataOptions,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult
} from '@tanstack/react-query';

import type {
  BackupCodes,
  BookRequest,
  BookingView,
  CodeRequest,
  Decision,
  DisableRequest,
  LinkRequest,
  ListAuditLogParams,
  ListJobsParams,
  ListUsersParams,
  ListVerificationQueueParams,
  LocationRequest,
  LocationView,
  LoginRequest,
  LoginResponse,
  MemberView,
  MessageResponse,
  MfaVerifyRequest,
  PageResponseAuditEntry,
  PageResponseJobView,
  PageResponseReviewItem,
  PageResponseUserView,
  PaymentResult,
  PaymentView,
  PlanView,
  ProviderView,
  ResendRequest,
  ReviewItem,
  RoleChange,
  SessionView,
  Setup,
  SignupRequest,
  SlotRequest,
  SlotView,
  SubscribeRequest,
  SubscriptionView,
  Summary,
  TokenResponse,
  UserView,
  VerificationForm,
  VerifyEmailParams,
  WaitlistView
} from './model';

import { customInstance } from '../client';
import type { ErrorType , BodyType } from '../client';
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];



export const submitVerification = (
    verificationForm: BodyType<VerificationForm>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      const formData = new FormData();
formData.append(`document`, verificationForm.document)
formData.append(`docType`, verificationForm.docType)
formData.append(`fullName`, verificationForm.fullName)
formData.append(`dateOfBirth`, verificationForm.dateOfBirth)
formData.append(`idNumber`, verificationForm.idNumber)
formData.append(`idExpiry`, verificationForm.idExpiry)

      return customInstance<MemberView>(
      {url: `/verifications`, method: 'POST',
      headers: {'Content-Type': 'multipart/form-data', },
       data: formData, signal
    },
      options);
    }
  


export const getSubmitVerificationMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof submitVerification>>, TError,{data: BodyType<VerificationForm>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof submitVerification>>, TError,{data: BodyType<VerificationForm>}, TContext> => {

const mutationKey = ['submitVerification'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof submitVerification>>, {data: BodyType<VerificationForm>}> = (props) => {
          const {data} = props ?? {};

          return  submitVerification(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type SubmitVerificationMutationResult = NonNullable<Awaited<ReturnType<typeof submitVerification>>>
    export type SubmitVerificationMutationBody = BodyType<VerificationForm>
    export type SubmitVerificationMutationError = ErrorType<unknown>

    export const useSubmitVerification = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof submitVerification>>, TError,{data: BodyType<VerificationForm>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof submitVerification>>,
        TError,
        {data: BodyType<VerificationForm>},
        TContext
      > => {

      const mutationOptions = getSubmitVerificationMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const subscribe = (
    subscribeRequest: BodyType<SubscribeRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PaymentResult>(
      {url: `/subscriptions`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: subscribeRequest, signal
    },
      options);
    }
  


export const getSubscribeMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof subscribe>>, TError,{data: BodyType<SubscribeRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof subscribe>>, TError,{data: BodyType<SubscribeRequest>}, TContext> => {

const mutationKey = ['subscribe'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof subscribe>>, {data: BodyType<SubscribeRequest>}> = (props) => {
          const {data} = props ?? {};

          return  subscribe(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type SubscribeMutationResult = NonNullable<Awaited<ReturnType<typeof subscribe>>>
    export type SubscribeMutationBody = BodyType<SubscribeRequest>
    export type SubscribeMutationError = ErrorType<unknown>

    export const useSubscribe = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof subscribe>>, TError,{data: BodyType<SubscribeRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof subscribe>>,
        TError,
        {data: BodyType<SubscribeRequest>},
        TContext
      > => {

      const mutationOptions = getSubscribeMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const renewSubscription = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PaymentResult>(
      {url: `/subscriptions/${id}/renew`, method: 'POST', signal
    },
      options);
    }
  


export const getRenewSubscriptionMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof renewSubscription>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof renewSubscription>>, TError,{id: string}, TContext> => {

const mutationKey = ['renewSubscription'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof renewSubscription>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  renewSubscription(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type RenewSubscriptionMutationResult = NonNullable<Awaited<ReturnType<typeof renewSubscription>>>
    
    export type RenewSubscriptionMutationError = ErrorType<unknown>

    export const useRenewSubscription = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof renewSubscription>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof renewSubscription>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getRenewSubscriptionMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const cancelSubscription = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<SubscriptionView>(
      {url: `/subscriptions/${id}/cancel`, method: 'POST', signal
    },
      options);
    }
  


export const getCancelSubscriptionMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof cancelSubscription>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof cancelSubscription>>, TError,{id: string}, TContext> => {

const mutationKey = ['cancelSubscription'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof cancelSubscription>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  cancelSubscription(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type CancelSubscriptionMutationResult = NonNullable<Awaited<ReturnType<typeof cancelSubscription>>>
    
    export type CancelSubscriptionMutationError = ErrorType<unknown>

    export const useCancelSubscription = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof cancelSubscription>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof cancelSubscription>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getCancelSubscriptionMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const joinWaitlist = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<WaitlistView>(
      {url: `/slots/${id}/waitlist`, method: 'POST', signal
    },
      options);
    }
  


export const getJoinWaitlistMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof joinWaitlist>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof joinWaitlist>>, TError,{id: string}, TContext> => {

const mutationKey = ['joinWaitlist'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof joinWaitlist>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  joinWaitlist(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type JoinWaitlistMutationResult = NonNullable<Awaited<ReturnType<typeof joinWaitlist>>>
    
    export type JoinWaitlistMutationError = ErrorType<unknown>

    export const useJoinWaitlist = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof joinWaitlist>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof joinWaitlist>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getJoinWaitlistMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const leaveWaitlist = (
    id: string,
 options?: SecondParameter<typeof customInstance>,) => {
      
      
      return customInstance<void>(
      {url: `/slots/${id}/waitlist`, method: 'DELETE'
    },
      options);
    }
  


export const getLeaveWaitlistMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof leaveWaitlist>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof leaveWaitlist>>, TError,{id: string}, TContext> => {

const mutationKey = ['leaveWaitlist'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof leaveWaitlist>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  leaveWaitlist(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type LeaveWaitlistMutationResult = NonNullable<Awaited<ReturnType<typeof leaveWaitlist>>>
    
    export type LeaveWaitlistMutationError = ErrorType<unknown>

    export const useLeaveWaitlist = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof leaveWaitlist>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof leaveWaitlist>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getLeaveWaitlistMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const setupMfa = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<Setup>(
      {url: `/me/mfa/setup`, method: 'POST', signal
    },
      options);
    }
  


export const getSetupMfaMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof setupMfa>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof setupMfa>>, TError,void, TContext> => {

const mutationKey = ['setupMfa'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof setupMfa>>, void> = () => {
          

          return  setupMfa(requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type SetupMfaMutationResult = NonNullable<Awaited<ReturnType<typeof setupMfa>>>
    
    export type SetupMfaMutationError = ErrorType<unknown>

    export const useSetupMfa = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof setupMfa>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof setupMfa>>,
        TError,
        void,
        TContext
      > => {

      const mutationOptions = getSetupMfaMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const enableMfa = (
    codeRequest: BodyType<CodeRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<BackupCodes>(
      {url: `/me/mfa/enable`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: codeRequest, signal
    },
      options);
    }
  


export const getEnableMfaMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof enableMfa>>, TError,{data: BodyType<CodeRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof enableMfa>>, TError,{data: BodyType<CodeRequest>}, TContext> => {

const mutationKey = ['enableMfa'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof enableMfa>>, {data: BodyType<CodeRequest>}> = (props) => {
          const {data} = props ?? {};

          return  enableMfa(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type EnableMfaMutationResult = NonNullable<Awaited<ReturnType<typeof enableMfa>>>
    export type EnableMfaMutationBody = BodyType<CodeRequest>
    export type EnableMfaMutationError = ErrorType<unknown>

    export const useEnableMfa = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof enableMfa>>, TError,{data: BodyType<CodeRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof enableMfa>>,
        TError,
        {data: BodyType<CodeRequest>},
        TContext
      > => {

      const mutationOptions = getEnableMfaMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const disableMfa = (
    disableRequest: BodyType<DisableRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<void>(
      {url: `/me/mfa/disable`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: disableRequest, signal
    },
      options);
    }
  


export const getDisableMfaMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof disableMfa>>, TError,{data: BodyType<DisableRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof disableMfa>>, TError,{data: BodyType<DisableRequest>}, TContext> => {

const mutationKey = ['disableMfa'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof disableMfa>>, {data: BodyType<DisableRequest>}> = (props) => {
          const {data} = props ?? {};

          return  disableMfa(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type DisableMfaMutationResult = NonNullable<Awaited<ReturnType<typeof disableMfa>>>
    export type DisableMfaMutationBody = BodyType<DisableRequest>
    export type DisableMfaMutationError = ErrorType<unknown>

    export const useDisableMfa = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof disableMfa>>, TError,{data: BodyType<DisableRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof disableMfa>>,
        TError,
        {data: BodyType<DisableRequest>},
        TContext
      > => {

      const mutationOptions = getDisableMfaMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const createBooking = (
    bookRequest: BodyType<BookRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<BookingView>(
      {url: `/bookings`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: bookRequest, signal
    },
      options);
    }
  


export const getCreateBookingMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createBooking>>, TError,{data: BodyType<BookRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof createBooking>>, TError,{data: BodyType<BookRequest>}, TContext> => {

const mutationKey = ['createBooking'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof createBooking>>, {data: BodyType<BookRequest>}> = (props) => {
          const {data} = props ?? {};

          return  createBooking(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type CreateBookingMutationResult = NonNullable<Awaited<ReturnType<typeof createBooking>>>
    export type CreateBookingMutationBody = BodyType<BookRequest>
    export type CreateBookingMutationError = ErrorType<unknown>

    export const useCreateBooking = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createBooking>>, TError,{data: BodyType<BookRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof createBooking>>,
        TError,
        {data: BodyType<BookRequest>},
        TContext
      > => {

      const mutationOptions = getCreateBookingMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const signup = (
    signupRequest: BodyType<SignupRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<MessageResponse>(
      {url: `/auth/signup`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: signupRequest, signal
    },
      options);
    }
  


export const getSignupMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof signup>>, TError,{data: BodyType<SignupRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof signup>>, TError,{data: BodyType<SignupRequest>}, TContext> => {

const mutationKey = ['signup'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof signup>>, {data: BodyType<SignupRequest>}> = (props) => {
          const {data} = props ?? {};

          return  signup(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type SignupMutationResult = NonNullable<Awaited<ReturnType<typeof signup>>>
    export type SignupMutationBody = BodyType<SignupRequest>
    export type SignupMutationError = ErrorType<unknown>

    export const useSignup = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof signup>>, TError,{data: BodyType<SignupRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof signup>>,
        TError,
        {data: BodyType<SignupRequest>},
        TContext
      > => {

      const mutationOptions = getSignupMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const resendVerification = (
    resendRequest: BodyType<ResendRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<MessageResponse>(
      {url: `/auth/resend-verification`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: resendRequest, signal
    },
      options);
    }
  


export const getResendVerificationMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof resendVerification>>, TError,{data: BodyType<ResendRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof resendVerification>>, TError,{data: BodyType<ResendRequest>}, TContext> => {

const mutationKey = ['resendVerification'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof resendVerification>>, {data: BodyType<ResendRequest>}> = (props) => {
          const {data} = props ?? {};

          return  resendVerification(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type ResendVerificationMutationResult = NonNullable<Awaited<ReturnType<typeof resendVerification>>>
    export type ResendVerificationMutationBody = BodyType<ResendRequest>
    export type ResendVerificationMutationError = ErrorType<unknown>

    export const useResendVerification = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof resendVerification>>, TError,{data: BodyType<ResendRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof resendVerification>>,
        TError,
        {data: BodyType<ResendRequest>},
        TContext
      > => {

      const mutationOptions = getResendVerificationMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const refreshSession = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<TokenResponse>(
      {url: `/auth/refresh`, method: 'POST', signal
    },
      options);
    }
  


export const getRefreshSessionMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof refreshSession>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof refreshSession>>, TError,void, TContext> => {

const mutationKey = ['refreshSession'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof refreshSession>>, void> = () => {
          

          return  refreshSession(requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type RefreshSessionMutationResult = NonNullable<Awaited<ReturnType<typeof refreshSession>>>
    
    export type RefreshSessionMutationError = ErrorType<unknown>

    export const useRefreshSession = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof refreshSession>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof refreshSession>>,
        TError,
        void,
        TContext
      > => {

      const mutationOptions = getRefreshSessionMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const confirmOAuthLink = (
    linkRequest: BodyType<LinkRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<LoginResponse>(
      {url: `/auth/oauth/link`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: linkRequest, signal
    },
      options);
    }
  


export const getConfirmOAuthLinkMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof confirmOAuthLink>>, TError,{data: BodyType<LinkRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof confirmOAuthLink>>, TError,{data: BodyType<LinkRequest>}, TContext> => {

const mutationKey = ['confirmOAuthLink'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof confirmOAuthLink>>, {data: BodyType<LinkRequest>}> = (props) => {
          const {data} = props ?? {};

          return  confirmOAuthLink(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type ConfirmOAuthLinkMutationResult = NonNullable<Awaited<ReturnType<typeof confirmOAuthLink>>>
    export type ConfirmOAuthLinkMutationBody = BodyType<LinkRequest>
    export type ConfirmOAuthLinkMutationError = ErrorType<unknown>

    export const useConfirmOAuthLink = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof confirmOAuthLink>>, TError,{data: BodyType<LinkRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof confirmOAuthLink>>,
        TError,
        {data: BodyType<LinkRequest>},
        TContext
      > => {

      const mutationOptions = getConfirmOAuthLinkMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const verifyMfa = (
    mfaVerifyRequest: BodyType<MfaVerifyRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<LoginResponse>(
      {url: `/auth/mfa/verify`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: mfaVerifyRequest, signal
    },
      options);
    }
  


export const getVerifyMfaMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof verifyMfa>>, TError,{data: BodyType<MfaVerifyRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof verifyMfa>>, TError,{data: BodyType<MfaVerifyRequest>}, TContext> => {

const mutationKey = ['verifyMfa'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof verifyMfa>>, {data: BodyType<MfaVerifyRequest>}> = (props) => {
          const {data} = props ?? {};

          return  verifyMfa(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type VerifyMfaMutationResult = NonNullable<Awaited<ReturnType<typeof verifyMfa>>>
    export type VerifyMfaMutationBody = BodyType<MfaVerifyRequest>
    export type VerifyMfaMutationError = ErrorType<unknown>

    export const useVerifyMfa = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof verifyMfa>>, TError,{data: BodyType<MfaVerifyRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof verifyMfa>>,
        TError,
        {data: BodyType<MfaVerifyRequest>},
        TContext
      > => {

      const mutationOptions = getVerifyMfaMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const logout = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<void>(
      {url: `/auth/logout`, method: 'POST', signal
    },
      options);
    }
  


export const getLogoutMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError,void, TContext> => {

const mutationKey = ['logout'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof logout>>, void> = () => {
          

          return  logout(requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>
    
    export type LogoutMutationError = ErrorType<unknown>

    export const useLogout = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof logout>>,
        TError,
        void,
        TContext
      > => {

      const mutationOptions = getLogoutMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const login = (
    loginRequest: BodyType<LoginRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<LoginResponse>(
      {url: `/auth/login`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: loginRequest, signal
    },
      options);
    }
  


export const getLoginMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof login>>, TError,{data: BodyType<LoginRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof login>>, TError,{data: BodyType<LoginRequest>}, TContext> => {

const mutationKey = ['login'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof login>>, {data: BodyType<LoginRequest>}> = (props) => {
          const {data} = props ?? {};

          return  login(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>
    export type LoginMutationBody = BodyType<LoginRequest>
    export type LoginMutationError = ErrorType<unknown>

    export const useLogin = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof login>>, TError,{data: BodyType<LoginRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof login>>,
        TError,
        {data: BodyType<LoginRequest>},
        TContext
      > => {

      const mutationOptions = getLoginMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const decideVerification = (
    id: string,
    decision: BodyType<Decision>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<ReviewItem>(
      {url: `/admin/verifications/${id}/decision`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: decision, signal
    },
      options);
    }
  


export const getDecideVerificationMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof decideVerification>>, TError,{id: string;data: BodyType<Decision>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof decideVerification>>, TError,{id: string;data: BodyType<Decision>}, TContext> => {

const mutationKey = ['decideVerification'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof decideVerification>>, {id: string;data: BodyType<Decision>}> = (props) => {
          const {id,data} = props ?? {};

          return  decideVerification(id,data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type DecideVerificationMutationResult = NonNullable<Awaited<ReturnType<typeof decideVerification>>>
    export type DecideVerificationMutationBody = BodyType<Decision>
    export type DecideVerificationMutationError = ErrorType<unknown>

    export const useDecideVerification = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof decideVerification>>, TError,{id: string;data: BodyType<Decision>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof decideVerification>>,
        TError,
        {id: string;data: BodyType<Decision>},
        TContext
      > => {

      const mutationOptions = getDecideVerificationMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const unlockUser = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<UserView>(
      {url: `/admin/users/${id}/unlock`, method: 'POST', signal
    },
      options);
    }
  


export const getUnlockUserMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof unlockUser>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof unlockUser>>, TError,{id: string}, TContext> => {

const mutationKey = ['unlockUser'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof unlockUser>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  unlockUser(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type UnlockUserMutationResult = NonNullable<Awaited<ReturnType<typeof unlockUser>>>
    
    export type UnlockUserMutationError = ErrorType<unknown>

    export const useUnlockUser = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof unlockUser>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof unlockUser>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getUnlockUserMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const revokeUserSessions = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<void>(
      {url: `/admin/users/${id}/sessions/revoke`, method: 'POST', signal
    },
      options);
    }
  


export const getRevokeUserSessionsMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof revokeUserSessions>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof revokeUserSessions>>, TError,{id: string}, TContext> => {

const mutationKey = ['revokeUserSessions'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof revokeUserSessions>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  revokeUserSessions(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type RevokeUserSessionsMutationResult = NonNullable<Awaited<ReturnType<typeof revokeUserSessions>>>
    
    export type RevokeUserSessionsMutationError = ErrorType<unknown>

    export const useRevokeUserSessions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof revokeUserSessions>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof revokeUserSessions>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getRevokeUserSessionsMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const createLocation = (
    locationRequest: BodyType<LocationRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<LocationView>(
      {url: `/admin/locations`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: locationRequest, signal
    },
      options);
    }
  


export const getCreateLocationMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createLocation>>, TError,{data: BodyType<LocationRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof createLocation>>, TError,{data: BodyType<LocationRequest>}, TContext> => {

const mutationKey = ['createLocation'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof createLocation>>, {data: BodyType<LocationRequest>}> = (props) => {
          const {data} = props ?? {};

          return  createLocation(data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type CreateLocationMutationResult = NonNullable<Awaited<ReturnType<typeof createLocation>>>
    export type CreateLocationMutationBody = BodyType<LocationRequest>
    export type CreateLocationMutationError = ErrorType<unknown>

    export const useCreateLocation = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createLocation>>, TError,{data: BodyType<LocationRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof createLocation>>,
        TError,
        {data: BodyType<LocationRequest>},
        TContext
      > => {

      const mutationOptions = getCreateLocationMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const createSlot = (
    id: string,
    slotRequest: BodyType<SlotRequest>,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<SlotView>(
      {url: `/admin/locations/${id}/slots`, method: 'POST',
      headers: {'Content-Type': 'application/json', },
      data: slotRequest, signal
    },
      options);
    }
  


export const getCreateSlotMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createSlot>>, TError,{id: string;data: BodyType<SlotRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof createSlot>>, TError,{id: string;data: BodyType<SlotRequest>}, TContext> => {

const mutationKey = ['createSlot'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof createSlot>>, {id: string;data: BodyType<SlotRequest>}> = (props) => {
          const {id,data} = props ?? {};

          return  createSlot(id,data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type CreateSlotMutationResult = NonNullable<Awaited<ReturnType<typeof createSlot>>>
    export type CreateSlotMutationBody = BodyType<SlotRequest>
    export type CreateSlotMutationError = ErrorType<unknown>

    export const useCreateSlot = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createSlot>>, TError,{id: string;data: BodyType<SlotRequest>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof createSlot>>,
        TError,
        {id: string;data: BodyType<SlotRequest>},
        TContext
      > => {

      const mutationOptions = getCreateSlotMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const retryJob = (
    id: number,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<void>(
      {url: `/admin/jobs/${id}/retry`, method: 'POST', signal
    },
      options);
    }
  


export const getRetryJobMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof retryJob>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof retryJob>>, TError,{id: number}, TContext> => {

const mutationKey = ['retryJob'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof retryJob>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  retryJob(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type RetryJobMutationResult = NonNullable<Awaited<ReturnType<typeof retryJob>>>
    
    export type RetryJobMutationError = ErrorType<unknown>

    export const useRetryJob = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof retryJob>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof retryJob>>,
        TError,
        {id: number},
        TContext
      > => {

      const mutationOptions = getRetryJobMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const changeUserRole = (
    id: string,
    roleChange: BodyType<RoleChange>,
 options?: SecondParameter<typeof customInstance>,) => {
      
      
      return customInstance<UserView>(
      {url: `/admin/users/${id}/role`, method: 'PATCH',
      headers: {'Content-Type': 'application/json', },
      data: roleChange
    },
      options);
    }
  


export const getChangeUserRoleMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof changeUserRole>>, TError,{id: string;data: BodyType<RoleChange>}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof changeUserRole>>, TError,{id: string;data: BodyType<RoleChange>}, TContext> => {

const mutationKey = ['changeUserRole'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof changeUserRole>>, {id: string;data: BodyType<RoleChange>}> = (props) => {
          const {id,data} = props ?? {};

          return  changeUserRole(id,data,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type ChangeUserRoleMutationResult = NonNullable<Awaited<ReturnType<typeof changeUserRole>>>
    export type ChangeUserRoleMutationBody = BodyType<RoleChange>
    export type ChangeUserRoleMutationError = ErrorType<unknown>

    export const useChangeUserRole = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof changeUserRole>>, TError,{id: string;data: BodyType<RoleChange>}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof changeUserRole>>,
        TError,
        {id: string;data: BodyType<RoleChange>},
        TContext
      > => {

      const mutationOptions = getChangeUserRoleMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const listMyVerifications = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<MemberView[]>(
      {url: `/verifications/me`, method: 'GET', signal
    },
      options);
    }
  



export const getListMyVerificationsQueryKey = () => {
    return [
    `/verifications/me`
    ] as const;
    }

    
export const getListMyVerificationsQueryOptions = <TData = Awaited<ReturnType<typeof listMyVerifications>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyVerifications>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListMyVerificationsQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listMyVerifications>>> = ({ signal }) => listMyVerifications(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listMyVerifications>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListMyVerificationsQueryResult = NonNullable<Awaited<ReturnType<typeof listMyVerifications>>>
export type ListMyVerificationsQueryError = ErrorType<unknown>


export function useListMyVerifications<TData = Awaited<ReturnType<typeof listMyVerifications>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyVerifications>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMyVerifications>>,
          TError,
          Awaited<ReturnType<typeof listMyVerifications>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMyVerifications<TData = Awaited<ReturnType<typeof listMyVerifications>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyVerifications>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMyVerifications>>,
          TError,
          Awaited<ReturnType<typeof listMyVerifications>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMyVerifications<TData = Awaited<ReturnType<typeof listMyVerifications>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyVerifications>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListMyVerifications<TData = Awaited<ReturnType<typeof listMyVerifications>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyVerifications>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListMyVerificationsQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listMySubscriptions = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<SubscriptionView[]>(
      {url: `/subscriptions/me`, method: 'GET', signal
    },
      options);
    }
  



export const getListMySubscriptionsQueryKey = () => {
    return [
    `/subscriptions/me`
    ] as const;
    }

    
export const getListMySubscriptionsQueryOptions = <TData = Awaited<ReturnType<typeof listMySubscriptions>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMySubscriptions>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListMySubscriptionsQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listMySubscriptions>>> = ({ signal }) => listMySubscriptions(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listMySubscriptions>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListMySubscriptionsQueryResult = NonNullable<Awaited<ReturnType<typeof listMySubscriptions>>>
export type ListMySubscriptionsQueryError = ErrorType<unknown>


export function useListMySubscriptions<TData = Awaited<ReturnType<typeof listMySubscriptions>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMySubscriptions>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMySubscriptions>>,
          TError,
          Awaited<ReturnType<typeof listMySubscriptions>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMySubscriptions<TData = Awaited<ReturnType<typeof listMySubscriptions>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMySubscriptions>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMySubscriptions>>,
          TError,
          Awaited<ReturnType<typeof listMySubscriptions>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMySubscriptions<TData = Awaited<ReturnType<typeof listMySubscriptions>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMySubscriptions>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListMySubscriptions<TData = Awaited<ReturnType<typeof listMySubscriptions>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMySubscriptions>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListMySubscriptionsQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listPlans = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PlanView[]>(
      {url: `/plans`, method: 'GET', signal
    },
      options);
    }
  



export const getListPlansQueryKey = () => {
    return [
    `/plans`
    ] as const;
    }

    
export const getListPlansQueryOptions = <TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListPlansQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listPlans>>> = ({ signal }) => listPlans(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListPlansQueryResult = NonNullable<Awaited<ReturnType<typeof listPlans>>>
export type ListPlansQueryError = ErrorType<unknown>


export function useListPlans<TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listPlans>>,
          TError,
          Awaited<ReturnType<typeof listPlans>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListPlans<TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listPlans>>,
          TError,
          Awaited<ReturnType<typeof listPlans>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListPlans<TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListPlans<TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListPlansQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listMyPayments = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PaymentView[]>(
      {url: `/payments/me`, method: 'GET', signal
    },
      options);
    }
  



export const getListMyPaymentsQueryKey = () => {
    return [
    `/payments/me`
    ] as const;
    }

    
export const getListMyPaymentsQueryOptions = <TData = Awaited<ReturnType<typeof listMyPayments>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyPayments>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListMyPaymentsQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listMyPayments>>> = ({ signal }) => listMyPayments(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listMyPayments>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListMyPaymentsQueryResult = NonNullable<Awaited<ReturnType<typeof listMyPayments>>>
export type ListMyPaymentsQueryError = ErrorType<unknown>


export function useListMyPayments<TData = Awaited<ReturnType<typeof listMyPayments>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyPayments>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMyPayments>>,
          TError,
          Awaited<ReturnType<typeof listMyPayments>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMyPayments<TData = Awaited<ReturnType<typeof listMyPayments>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyPayments>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMyPayments>>,
          TError,
          Awaited<ReturnType<typeof listMyPayments>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMyPayments<TData = Awaited<ReturnType<typeof listMyPayments>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyPayments>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListMyPayments<TData = Awaited<ReturnType<typeof listMyPayments>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyPayments>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListMyPaymentsQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const getCurrentUser = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<UserView>(
      {url: `/me`, method: 'GET', signal
    },
      options);
    }
  



export const getGetCurrentUserQueryKey = () => {
    return [
    `/me`
    ] as const;
    }

    
export const getGetCurrentUserQueryOptions = <TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getGetCurrentUserQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof getCurrentUser>>> = ({ signal }) => getCurrentUser(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type GetCurrentUserQueryResult = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
export type GetCurrentUserQueryError = ErrorType<unknown>


export function useGetCurrentUser<TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof getCurrentUser>>,
          TError,
          Awaited<ReturnType<typeof getCurrentUser>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useGetCurrentUser<TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof getCurrentUser>>,
          TError,
          Awaited<ReturnType<typeof getCurrentUser>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useGetCurrentUser<TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useGetCurrentUser<TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getGetCurrentUserQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listSessions = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<SessionView[]>(
      {url: `/me/sessions`, method: 'GET', signal
    },
      options);
    }
  



export const getListSessionsQueryKey = () => {
    return [
    `/me/sessions`
    ] as const;
    }

    
export const getListSessionsQueryOptions = <TData = Awaited<ReturnType<typeof listSessions>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSessions>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListSessionsQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listSessions>>> = ({ signal }) => listSessions(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listSessions>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListSessionsQueryResult = NonNullable<Awaited<ReturnType<typeof listSessions>>>
export type ListSessionsQueryError = ErrorType<unknown>


export function useListSessions<TData = Awaited<ReturnType<typeof listSessions>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSessions>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listSessions>>,
          TError,
          Awaited<ReturnType<typeof listSessions>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListSessions<TData = Awaited<ReturnType<typeof listSessions>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSessions>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listSessions>>,
          TError,
          Awaited<ReturnType<typeof listSessions>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListSessions<TData = Awaited<ReturnType<typeof listSessions>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSessions>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListSessions<TData = Awaited<ReturnType<typeof listSessions>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSessions>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListSessionsQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const revokeAllSessions = (
    
 options?: SecondParameter<typeof customInstance>,) => {
      
      
      return customInstance<void>(
      {url: `/me/sessions`, method: 'DELETE'
    },
      options);
    }
  


export const getRevokeAllSessionsMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof revokeAllSessions>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof revokeAllSessions>>, TError,void, TContext> => {

const mutationKey = ['revokeAllSessions'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof revokeAllSessions>>, void> = () => {
          

          return  revokeAllSessions(requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type RevokeAllSessionsMutationResult = NonNullable<Awaited<ReturnType<typeof revokeAllSessions>>>
    
    export type RevokeAllSessionsMutationError = ErrorType<unknown>

    export const useRevokeAllSessions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof revokeAllSessions>>, TError,void, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof revokeAllSessions>>,
        TError,
        void,
        TContext
      > => {

      const mutationOptions = getRevokeAllSessionsMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const listLocations = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<LocationView[]>(
      {url: `/locations`, method: 'GET', signal
    },
      options);
    }
  



export const getListLocationsQueryKey = () => {
    return [
    `/locations`
    ] as const;
    }

    
export const getListLocationsQueryOptions = <TData = Awaited<ReturnType<typeof listLocations>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listLocations>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListLocationsQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listLocations>>> = ({ signal }) => listLocations(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listLocations>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListLocationsQueryResult = NonNullable<Awaited<ReturnType<typeof listLocations>>>
export type ListLocationsQueryError = ErrorType<unknown>


export function useListLocations<TData = Awaited<ReturnType<typeof listLocations>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listLocations>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listLocations>>,
          TError,
          Awaited<ReturnType<typeof listLocations>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListLocations<TData = Awaited<ReturnType<typeof listLocations>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listLocations>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listLocations>>,
          TError,
          Awaited<ReturnType<typeof listLocations>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListLocations<TData = Awaited<ReturnType<typeof listLocations>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listLocations>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListLocations<TData = Awaited<ReturnType<typeof listLocations>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listLocations>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListLocationsQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listSlots = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<SlotView[]>(
      {url: `/locations/${id}/slots`, method: 'GET', signal
    },
      options);
    }
  



export const getListSlotsQueryKey = (id?: string,) => {
    return [
    `/locations/${id}/slots`
    ] as const;
    }

    
export const getListSlotsQueryOptions = <TData = Awaited<ReturnType<typeof listSlots>>, TError = ErrorType<unknown>>(id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSlots>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListSlotsQueryKey(id);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listSlots>>> = ({ signal }) => listSlots(id, requestOptions, signal);

      

      

   return  { queryKey, queryFn, enabled: !!(id), ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listSlots>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListSlotsQueryResult = NonNullable<Awaited<ReturnType<typeof listSlots>>>
export type ListSlotsQueryError = ErrorType<unknown>


export function useListSlots<TData = Awaited<ReturnType<typeof listSlots>>, TError = ErrorType<unknown>>(
 id: string, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSlots>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listSlots>>,
          TError,
          Awaited<ReturnType<typeof listSlots>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListSlots<TData = Awaited<ReturnType<typeof listSlots>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSlots>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listSlots>>,
          TError,
          Awaited<ReturnType<typeof listSlots>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListSlots<TData = Awaited<ReturnType<typeof listSlots>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSlots>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListSlots<TData = Awaited<ReturnType<typeof listSlots>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listSlots>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListSlotsQueryOptions(id,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listMyBookings = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<BookingView[]>(
      {url: `/bookings/me`, method: 'GET', signal
    },
      options);
    }
  



export const getListMyBookingsQueryKey = () => {
    return [
    `/bookings/me`
    ] as const;
    }

    
export const getListMyBookingsQueryOptions = <TData = Awaited<ReturnType<typeof listMyBookings>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyBookings>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListMyBookingsQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listMyBookings>>> = ({ signal }) => listMyBookings(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listMyBookings>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListMyBookingsQueryResult = NonNullable<Awaited<ReturnType<typeof listMyBookings>>>
export type ListMyBookingsQueryError = ErrorType<unknown>


export function useListMyBookings<TData = Awaited<ReturnType<typeof listMyBookings>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyBookings>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMyBookings>>,
          TError,
          Awaited<ReturnType<typeof listMyBookings>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMyBookings<TData = Awaited<ReturnType<typeof listMyBookings>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyBookings>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listMyBookings>>,
          TError,
          Awaited<ReturnType<typeof listMyBookings>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListMyBookings<TData = Awaited<ReturnType<typeof listMyBookings>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyBookings>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListMyBookings<TData = Awaited<ReturnType<typeof listMyBookings>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyBookings>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListMyBookingsQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const verifyEmail = (
    params: VerifyEmailParams,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<MessageResponse>(
      {url: `/auth/verify-email`, method: 'GET',
        params, signal
    },
      options);
    }
  



export const getVerifyEmailQueryKey = (params?: VerifyEmailParams,) => {
    return [
    `/auth/verify-email`, ...(params ? [params]: [])
    ] as const;
    }

    
export const getVerifyEmailQueryOptions = <TData = Awaited<ReturnType<typeof verifyEmail>>, TError = ErrorType<unknown>>(params: VerifyEmailParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof verifyEmail>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getVerifyEmailQueryKey(params);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof verifyEmail>>> = ({ signal }) => verifyEmail(params, requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof verifyEmail>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type VerifyEmailQueryResult = NonNullable<Awaited<ReturnType<typeof verifyEmail>>>
export type VerifyEmailQueryError = ErrorType<unknown>


export function useVerifyEmail<TData = Awaited<ReturnType<typeof verifyEmail>>, TError = ErrorType<unknown>>(
 params: VerifyEmailParams, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof verifyEmail>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof verifyEmail>>,
          TError,
          Awaited<ReturnType<typeof verifyEmail>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useVerifyEmail<TData = Awaited<ReturnType<typeof verifyEmail>>, TError = ErrorType<unknown>>(
 params: VerifyEmailParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof verifyEmail>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof verifyEmail>>,
          TError,
          Awaited<ReturnType<typeof verifyEmail>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useVerifyEmail<TData = Awaited<ReturnType<typeof verifyEmail>>, TError = ErrorType<unknown>>(
 params: VerifyEmailParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof verifyEmail>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useVerifyEmail<TData = Awaited<ReturnType<typeof verifyEmail>>, TError = ErrorType<unknown>>(
 params: VerifyEmailParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof verifyEmail>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getVerifyEmailQueryOptions(params,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listProviders = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<ProviderView[]>(
      {url: `/auth/providers`, method: 'GET', signal
    },
      options);
    }
  



export const getListProvidersQueryKey = () => {
    return [
    `/auth/providers`
    ] as const;
    }

    
export const getListProvidersQueryOptions = <TData = Awaited<ReturnType<typeof listProviders>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listProviders>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListProvidersQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listProviders>>> = ({ signal }) => listProviders(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listProviders>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListProvidersQueryResult = NonNullable<Awaited<ReturnType<typeof listProviders>>>
export type ListProvidersQueryError = ErrorType<unknown>


export function useListProviders<TData = Awaited<ReturnType<typeof listProviders>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listProviders>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listProviders>>,
          TError,
          Awaited<ReturnType<typeof listProviders>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListProviders<TData = Awaited<ReturnType<typeof listProviders>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listProviders>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listProviders>>,
          TError,
          Awaited<ReturnType<typeof listProviders>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListProviders<TData = Awaited<ReturnType<typeof listProviders>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listProviders>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListProviders<TData = Awaited<ReturnType<typeof listProviders>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listProviders>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListProvidersQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listVerificationQueue = (
    params?: ListVerificationQueueParams,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PageResponseReviewItem>(
      {url: `/admin/verifications`, method: 'GET',
        params, signal
    },
      options);
    }
  



export const getListVerificationQueueQueryKey = (params?: ListVerificationQueueParams,) => {
    return [
    `/admin/verifications`, ...(params ? [params]: [])
    ] as const;
    }

    
export const getListVerificationQueueQueryOptions = <TData = Awaited<ReturnType<typeof listVerificationQueue>>, TError = ErrorType<unknown>>(params?: ListVerificationQueueParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listVerificationQueue>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListVerificationQueueQueryKey(params);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listVerificationQueue>>> = ({ signal }) => listVerificationQueue(params, requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listVerificationQueue>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListVerificationQueueQueryResult = NonNullable<Awaited<ReturnType<typeof listVerificationQueue>>>
export type ListVerificationQueueQueryError = ErrorType<unknown>


export function useListVerificationQueue<TData = Awaited<ReturnType<typeof listVerificationQueue>>, TError = ErrorType<unknown>>(
 params: undefined |  ListVerificationQueueParams, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listVerificationQueue>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listVerificationQueue>>,
          TError,
          Awaited<ReturnType<typeof listVerificationQueue>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListVerificationQueue<TData = Awaited<ReturnType<typeof listVerificationQueue>>, TError = ErrorType<unknown>>(
 params?: ListVerificationQueueParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listVerificationQueue>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listVerificationQueue>>,
          TError,
          Awaited<ReturnType<typeof listVerificationQueue>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListVerificationQueue<TData = Awaited<ReturnType<typeof listVerificationQueue>>, TError = ErrorType<unknown>>(
 params?: ListVerificationQueueParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listVerificationQueue>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListVerificationQueue<TData = Awaited<ReturnType<typeof listVerificationQueue>>, TError = ErrorType<unknown>>(
 params?: ListVerificationQueueParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listVerificationQueue>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListVerificationQueueQueryOptions(params,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const getVerification = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<ReviewItem>(
      {url: `/admin/verifications/${id}`, method: 'GET', signal
    },
      options);
    }
  



export const getGetVerificationQueryKey = (id?: string,) => {
    return [
    `/admin/verifications/${id}`
    ] as const;
    }

    
export const getGetVerificationQueryOptions = <TData = Awaited<ReturnType<typeof getVerification>>, TError = ErrorType<unknown>>(id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getVerification>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getGetVerificationQueryKey(id);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof getVerification>>> = ({ signal }) => getVerification(id, requestOptions, signal);

      

      

   return  { queryKey, queryFn, enabled: !!(id), ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof getVerification>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type GetVerificationQueryResult = NonNullable<Awaited<ReturnType<typeof getVerification>>>
export type GetVerificationQueryError = ErrorType<unknown>


export function useGetVerification<TData = Awaited<ReturnType<typeof getVerification>>, TError = ErrorType<unknown>>(
 id: string, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof getVerification>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof getVerification>>,
          TError,
          Awaited<ReturnType<typeof getVerification>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useGetVerification<TData = Awaited<ReturnType<typeof getVerification>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getVerification>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof getVerification>>,
          TError,
          Awaited<ReturnType<typeof getVerification>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useGetVerification<TData = Awaited<ReturnType<typeof getVerification>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getVerification>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useGetVerification<TData = Awaited<ReturnType<typeof getVerification>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getVerification>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getGetVerificationQueryOptions(id,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const downloadVerificationDocument = (
    id: string,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<Blob>(
      {url: `/admin/verifications/${id}/document`, method: 'GET',
        responseType: 'blob', signal
    },
      options);
    }
  



export const getDownloadVerificationDocumentQueryKey = (id?: string,) => {
    return [
    `/admin/verifications/${id}/document`
    ] as const;
    }

    
export const getDownloadVerificationDocumentQueryOptions = <TData = Awaited<ReturnType<typeof downloadVerificationDocument>>, TError = ErrorType<unknown>>(id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof downloadVerificationDocument>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getDownloadVerificationDocumentQueryKey(id);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof downloadVerificationDocument>>> = ({ signal }) => downloadVerificationDocument(id, requestOptions, signal);

      

      

   return  { queryKey, queryFn, enabled: !!(id), ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof downloadVerificationDocument>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type DownloadVerificationDocumentQueryResult = NonNullable<Awaited<ReturnType<typeof downloadVerificationDocument>>>
export type DownloadVerificationDocumentQueryError = ErrorType<unknown>


export function useDownloadVerificationDocument<TData = Awaited<ReturnType<typeof downloadVerificationDocument>>, TError = ErrorType<unknown>>(
 id: string, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof downloadVerificationDocument>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof downloadVerificationDocument>>,
          TError,
          Awaited<ReturnType<typeof downloadVerificationDocument>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useDownloadVerificationDocument<TData = Awaited<ReturnType<typeof downloadVerificationDocument>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof downloadVerificationDocument>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof downloadVerificationDocument>>,
          TError,
          Awaited<ReturnType<typeof downloadVerificationDocument>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useDownloadVerificationDocument<TData = Awaited<ReturnType<typeof downloadVerificationDocument>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof downloadVerificationDocument>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useDownloadVerificationDocument<TData = Awaited<ReturnType<typeof downloadVerificationDocument>>, TError = ErrorType<unknown>>(
 id: string, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof downloadVerificationDocument>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getDownloadVerificationDocumentQueryOptions(id,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listUsers = (
    params?: ListUsersParams,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PageResponseUserView>(
      {url: `/admin/users`, method: 'GET',
        params, signal
    },
      options);
    }
  



export const getListUsersQueryKey = (params?: ListUsersParams,) => {
    return [
    `/admin/users`, ...(params ? [params]: [])
    ] as const;
    }

    
export const getListUsersQueryOptions = <TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(params?: ListUsersParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListUsersQueryKey(params);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listUsers>>> = ({ signal }) => listUsers(params, requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listUsers>>>
export type ListUsersQueryError = ErrorType<unknown>


export function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(
 params: undefined |  ListUsersParams, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listUsers>>,
          TError,
          Awaited<ReturnType<typeof listUsers>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(
 params?: ListUsersParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listUsers>>,
          TError,
          Awaited<ReturnType<typeof listUsers>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(
 params?: ListUsersParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(
 params?: ListUsersParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListUsersQueryOptions(params,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const getMetricsSummary = (
    
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<Summary>(
      {url: `/admin/metrics/summary`, method: 'GET', signal
    },
      options);
    }
  



export const getGetMetricsSummaryQueryKey = () => {
    return [
    `/admin/metrics/summary`
    ] as const;
    }

    
export const getGetMetricsSummaryQueryOptions = <TData = Awaited<ReturnType<typeof getMetricsSummary>>, TError = ErrorType<unknown>>( options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getMetricsSummary>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getGetMetricsSummaryQueryKey();

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof getMetricsSummary>>> = ({ signal }) => getMetricsSummary(requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof getMetricsSummary>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type GetMetricsSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getMetricsSummary>>>
export type GetMetricsSummaryQueryError = ErrorType<unknown>


export function useGetMetricsSummary<TData = Awaited<ReturnType<typeof getMetricsSummary>>, TError = ErrorType<unknown>>(
  options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof getMetricsSummary>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof getMetricsSummary>>,
          TError,
          Awaited<ReturnType<typeof getMetricsSummary>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useGetMetricsSummary<TData = Awaited<ReturnType<typeof getMetricsSummary>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getMetricsSummary>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof getMetricsSummary>>,
          TError,
          Awaited<ReturnType<typeof getMetricsSummary>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useGetMetricsSummary<TData = Awaited<ReturnType<typeof getMetricsSummary>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getMetricsSummary>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useGetMetricsSummary<TData = Awaited<ReturnType<typeof getMetricsSummary>>, TError = ErrorType<unknown>>(
  options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof getMetricsSummary>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getGetMetricsSummaryQueryOptions(options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listJobs = (
    params?: ListJobsParams,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PageResponseJobView>(
      {url: `/admin/jobs`, method: 'GET',
        params, signal
    },
      options);
    }
  



export const getListJobsQueryKey = (params?: ListJobsParams,) => {
    return [
    `/admin/jobs`, ...(params ? [params]: [])
    ] as const;
    }

    
export const getListJobsQueryOptions = <TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(params?: ListJobsParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListJobsQueryKey(params);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listJobs>>> = ({ signal }) => listJobs(params, requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListJobsQueryResult = NonNullable<Awaited<ReturnType<typeof listJobs>>>
export type ListJobsQueryError = ErrorType<unknown>


export function useListJobs<TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(
 params: undefined |  ListJobsParams, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listJobs>>,
          TError,
          Awaited<ReturnType<typeof listJobs>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListJobs<TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(
 params?: ListJobsParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listJobs>>,
          TError,
          Awaited<ReturnType<typeof listJobs>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListJobs<TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(
 params?: ListJobsParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListJobs<TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(
 params?: ListJobsParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListJobsQueryOptions(params,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const listAuditLog = (
    params?: ListAuditLogParams,
 options?: SecondParameter<typeof customInstance>,signal?: AbortSignal
) => {
      
      
      return customInstance<PageResponseAuditEntry>(
      {url: `/admin/audit-log`, method: 'GET',
        params, signal
    },
      options);
    }
  



export const getListAuditLogQueryKey = (params?: ListAuditLogParams,) => {
    return [
    `/admin/audit-log`, ...(params ? [params]: [])
    ] as const;
    }

    
export const getListAuditLogQueryOptions = <TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<unknown>>(params?: ListAuditLogParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListAuditLogQueryKey(params);

  

    const queryFn: QueryFunction<Awaited<ReturnType<typeof listAuditLog>>> = ({ signal }) => listAuditLog(params, requestOptions, signal);

      

      

   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData> & { queryKey: DataTag<QueryKey, TData, TError> }
}

export type ListAuditLogQueryResult = NonNullable<Awaited<ReturnType<typeof listAuditLog>>>
export type ListAuditLogQueryError = ErrorType<unknown>


export function useListAuditLog<TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<unknown>>(
 params: undefined |  ListAuditLogParams, options: { query:Partial<UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>> & Pick<
        DefinedInitialDataOptions<
          Awaited<ReturnType<typeof listAuditLog>>,
          TError,
          Awaited<ReturnType<typeof listAuditLog>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  DefinedUseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListAuditLog<TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<unknown>>(
 params?: ListAuditLogParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>> & Pick<
        UndefinedInitialDataOptions<
          Awaited<ReturnType<typeof listAuditLog>>,
          TError,
          Awaited<ReturnType<typeof listAuditLog>>
        > , 'initialData'
      >, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }
export function useListAuditLog<TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<unknown>>(
 params?: ListAuditLogParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient
  ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> }

export function useListAuditLog<TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<unknown>>(
 params?: ListAuditLogParams, options?: { query?:Partial<UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient 
 ):  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {

  const queryOptions = getListAuditLogQueryOptions(params,options)

  const query = useQuery(queryOptions, queryClient) as  UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> };

  query.queryKey = queryOptions.queryKey ;

  return query;
}




export const revokeSession = (
    id: string,
 options?: SecondParameter<typeof customInstance>,) => {
      
      
      return customInstance<void>(
      {url: `/me/sessions/${id}`, method: 'DELETE'
    },
      options);
    }
  


export const getRevokeSessionMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof revokeSession>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof revokeSession>>, TError,{id: string}, TContext> => {

const mutationKey = ['revokeSession'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof revokeSession>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  revokeSession(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type RevokeSessionMutationResult = NonNullable<Awaited<ReturnType<typeof revokeSession>>>
    
    export type RevokeSessionMutationError = ErrorType<unknown>

    export const useRevokeSession = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof revokeSession>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof revokeSession>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getRevokeSessionMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
    
export const cancelBooking = (
    id: string,
 options?: SecondParameter<typeof customInstance>,) => {
      
      
      return customInstance<void>(
      {url: `/bookings/${id}`, method: 'DELETE'
    },
      options);
    }
  


export const getCancelBookingMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof cancelBooking>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
): UseMutationOptions<Awaited<ReturnType<typeof cancelBooking>>, TError,{id: string}, TContext> => {

const mutationKey = ['cancelBooking'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};

      


      const mutationFn: MutationFunction<Awaited<ReturnType<typeof cancelBooking>>, {id: string}> = (props) => {
          const {id} = props ?? {};

          return  cancelBooking(id,requestOptions)
        }

        


  return  { mutationFn, ...mutationOptions }}

    export type CancelBookingMutationResult = NonNullable<Awaited<ReturnType<typeof cancelBooking>>>
    
    export type CancelBookingMutationError = ErrorType<unknown>

    export const useCancelBooking = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof cancelBooking>>, TError,{id: string}, TContext>, request?: SecondParameter<typeof customInstance>}
 , queryClient?: QueryClient): UseMutationResult<
        Awaited<ReturnType<typeof cancelBooking>>,
        TError,
        {id: string},
        TContext
      > => {

      const mutationOptions = getCancelBookingMutationOptions(options);

      return useMutation(mutationOptions, queryClient);
    }
