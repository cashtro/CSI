(function ($) {
	"use strict";

	$(window).on('load', function () {
		preloader();
		wowAnimation();
	});

	/*------------------------------------------
	= preloader
	-------------------------------------------
	function preloader() {
		$('#xb-loadding').delay().fadeOut();
	};*/

	/*------------------------------------------
	= back to top
	-------------------------------------------*/
	$(window).scroll(function () {
		if ($(this).scrollTop() > 500) {
			$('.xb-backtotop').addClass('active');
		} else {
			$('.xb-backtotop').removeClass('active');
		}
	});  
	$(function () {
		$(".scroll").on('click', function () {
			$("html,body").animate({ scrollTop: 0 }, "slow");
			return false
		});
	});

	 // Sticky Header - Start
	// --------------------------------------------------
	if ($('.stricky').length) {
		$('.stricky').addClass('original').clone(true).insertAfter('.stricky').addClass('stricked-menu').removeClass('original');
	}
	$(window).on('scroll', function () {
		if ($('.stricked-menu').length) {
		var headerScrollPos = 150;
		var stricky = $('.stricked-menu');
		if ($(window).scrollTop() > headerScrollPos) {
			stricky.addClass('stricky-fixed');
		} else if ($(this).scrollTop() <= headerScrollPos) {
			stricky.removeClass('stricky-fixed');
		}
		}
	});
	// Sticky Header - End

	/*------------------------------------------
	= header search
	-------------------------------------------*/
	$(".header-search-btn").on("click", function (e) {
		e.preventDefault();
		$(".header-search-form-wrapper").addClass("open");
		$('.header-search-form-wrapper input[type="search"]').focus();
		$('.body-overlay').addClass('active');
	});
	$(".xb-search-close").on("click", function (e) {
		e.preventDefault();
		$(".header-search-form-wrapper").removeClass("open");
		$("body").removeClass("active");
		$('.body-overlay').removeClass('active');
	});

	/*------------------------------------------
	= sidebar
	-------------------------------------------*/
	$('.sidebar-menu-close, .body-overlay').on('click', function () {
		$('.offcanvas-sidebar').removeClass('active');
		$('.body-overlay').removeClass('active');
	});

	$('.offcanvas-sidebar-btn').on('click', function () {
		$('.offcanvas-sidebar').addClass('active');
		$('.body-overlay').addClass('active');
	});
	$('.body-overlay').on('click', function () {
		$(this).removeClass('active');
		$(".header-search-form-wrapper").removeClass("open");
	});

	/*------------------------------------------
	= mobile menu
	-------------------------------------------*/
	$('.xb-nav-hidden li.menu-item-has-children > a').append('<span class="xb-menu-toggle"></span>');
	$('.xb-header-menu li.menu-item-has-children, .xb-menu-primary li.menu-item-has-children').append('<span class="xb-menu-toggle"></span>');
	$('.xb-menu-toggle').on('click', function () {
		if (!$(this).hasClass('active')) {
			$(this).closest('ul').find('.xb-menu-toggle.active').toggleClass('active');
			$(this).closest('ul').find('.sub-menu.active').toggleClass('active').slideToggle();
		}
		$(this).toggleClass('active');
		$(this).closest('.menu-item').find('> .sub-menu').toggleClass('active');
		$(this).closest('.menu-item').find('> .sub-menu').slideToggle();
	});

	$('.xb-nav-hidden li.menu-item-has-children > a').click(function (e) {
		var target = $(e.target);
		if ($(this).attr('href') === '#' && !(target.is('.xb-menu-toggle'))) {
			e.stopPropagation();
			if (!$(this).find('.xb-menu-toggle').hasClass('active')) {
				$(this).closest('ul').find('.xb-menu-toggle.active').toggleClass('active');
				$(this).closest('ul').find('.sub-menu.active').toggleClass('active').slideToggle();
			}
			$(this).find('.xb-menu-toggle').toggleClass('active');
			$(this).closest('.menu-item').find('> .sub-menu').toggleClass('active');
			$(this).closest('.menu-item').find('> .sub-menu').slideToggle();
		}
	});
	$(".xb-nav-mobile").on('click', function () {
		$(this).toggleClass('active');
		$('.xb-header-menu').toggleClass('active');
		$('body').toggleClass('body-overflow');
	});

	$(".xb-menu-close, .xb-header-menu-backdrop").on('click', function () {
		$(this).removeClass('active');
		$('.xb-header-menu').removeClass('active');
		$('body').removeClass('body-overflow');
	});

	/*------------------------------------------
	= nice select
	-------------------------------------------*/
	$('select').niceSelect();

	/*------------------------------------------
	= data background and bg color
	-------------------------------------------*/
	$("[data-background]").each(function () {
		$(this).css("background-image", "url(" + $(this).attr("data-background") + ") ")
	})
	$("[data-bg-color]").each(function () {
		$(this).css("background-color", $(this).attr("data-bg-color"));

	});

	 // Background Parallax - Start
  	// --------------------------------------------------
	$('.parallaxie').parallaxie({
		speed: 0.5,
		offset: 0,
	});
	// Background Parallax - End
	// --------------------------------------------------

	/*------------------------------------------
	= aos animation
	-------------------------------------------*/
	function wowAnimation() {
		var wow = new WOW({
			boxClass: 'wow',
			animateClass: 'animated',
			offset: 0,
			mobile: false,
			live: true
		});
		wow.init();
	}


	/*------------------------------------------
	= counter
	-------------------------------------------*/
	if ($(".xbo").length) {
		$('.xbo').appear();
		$(document.body).on('appear', '.xbo', function (e) {
			var odo = $(".xbo");
			odo.each(function () {
				var countNumber = $(this).attr("data-count");
				$(this).html(countNumber);
			});
			window.xboOptions = {
				format: 'd',
			};
		});
	}

	if ($(".xbo_trigger").length) {
        var odo = $(".xbo_trigger");
        odo.each(function () {
            var countNumber = $(this).attr("data-count");
            var odometerInstance = new Odometer({
                el: this,
                value: 0,
                format: 'd',
            });
            odometerInstance.render();
            odometerInstance.update(countNumber);
        });
        $('.xbo_trigger').appear();
        $(document.body).on('appear', '.xboh', function (e) {
            // This event handler can be empty or used for additional functionality if needed
        });
    }

	/*------------------------------------------
	= isotop
	-------------------------------------------*/
	$('.grid').imagesLoaded(function () {
		var $grid = $('.grid').isotope({
			itemSelector: '.grid-item',
			percentPosition: true,
			masonry: {
				// use outer width of grid-sizer for columnWidth
				columnWidth: '.grid-item',
			}
		});

		// filter items on button click
		$('.team-menu').on('click', 'button', function () {
			var filterValue = $(this).attr('data-filter');
			$grid.isotope({ filter: filterValue });
		});
	});

	//for menu active class
	$('.team-menu button').on('click', function (event) {
		$(this).siblings('.active').removeClass('active');
		$(this).addClass('active');
		event.preventDefault();
	});


	// service Js
	function service_animation() {
		var active_bg = $(".service-list .active-bg");
		var element = $(".service-list .current");
	
		function activeServiceList(active_bg, e) {
			if (!e.length) {
				active_bg.css({ height: "100%" });
				return false;
			}
			var topOff = e.offset().top;
			var height = e.outerHeight();
			var menuTop = $(".service-list").offset().top;
	
			active_bg.css({ top: topOff - menuTop + "px", height: height + "px" });
			e.closest(".service-list-item").removeClass("mleave").addClass("current");
			e.closest(".service-list-item").siblings().removeClass("current").addClass("mleave");
		}
	
		$(".service-list .service-list-item").on("mouseenter", function () {
			var e = $(this);
			var index = e.index();
	
			activeServiceList(active_bg, e);
			$(".service-images .service-image-item").removeClass("active").eq(index).addClass("active");
			$(".service-content-image .xb-item--img").removeClass("active").eq(index).addClass("active");
		});
	
		$(".service-list").on("mouseleave", function () {
			element = $(".service-list .current");
			var index = element.index();
	
			activeServiceList(active_bg, element);
	
			$(".service-images .service-image-item").removeClass("active").eq(index).addClass("active");
			$(".service-content-image .xb-item--img").removeClass("active").eq(index).addClass("active");
	
			element.closest(".service-list-item").siblings().removeClass("mleave");
		});
	
		$(".service-list .service-list-item").on("click", function () {
			$(".service-list .service-list-item").removeClass("current");
			$(this).addClass("current");
	
			var index = $(this).index();
			$(".service-images .service-image-item").removeClass("active").eq(index).addClass("active");
			$(".service-content-image .xb-item--img").removeClass("active").eq(index).addClass("active");
		});
		activeServiceList(active_bg, element);
	}
	
	service_animation();
	
	
	/*------------------------------------------
	= testimonial slide
	-------------------------------------------*/
	var slider = new Swiper(".testimonial-slider", {
		loop: true,
		spaceBetween: 30,
		speed: 400,
		slidesPerView: 3,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			type: "fraction",
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 3,
			},
			'768': {
				slidesPerView: 2,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= project slide
	-------------------------------------------*/
	var slider = new Swiper(".project-slider", {
		loop: true,
		spaceBetween: 60,
		speed: 400,
		slidesPerView: 3,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		breakpoints: {
			'1600': {
				slidesPerView: 3,
			},
			'1024': {
				slidesPerView: 1,
			},
			'768': {
				slidesPerView: 1,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= brand slide
	-------------------------------------------*/
	// var brandSliderNav = new Swiper(".brand-slider-nav", {
	// 	loop: false,
	// 	spaceBetween: 160,
	// 	speed: 400,
	// 	slidesPerView: 4,
	// 	autoplay: {
	// 		enabled: true,
	// 		delay: 6000
	// 	},
	// 	breakpoints: {
	// 		'1600': {
	// 			slidesPerView: 4,
	// 		},
	// 		'768': {
	// 			slidesPerView: 3,
	// 		},
	// 		'576': {
	// 			slidesPerView: 3,
	// 		},
	// 		'0': {
	// 			slidesPerView: 1,
	// 		},
	// 	},
	// });
	// var brandSlider = new Swiper(".sa-project-slider", {
	// 	loop: true,
	// 	spaceBetween: 100,
	// 	slidesPerView: 3,
	// 	thumbs: {
	// 		swiper: brandSliderNav,
	// 	},
	// });
	var testimonialNav = new Swiper(".brand-slider-nav", {
		spaceBetween: 4,
		slidesPerView: 5,
		loop: true,
		freeMode: true,
		watchSlidesProgress: true,
		allowTouchMove: false,
		breakpoints: {
			'992': {
				slidesPerView: 5,
			},
			'768': {
				slidesPerView: 3,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	var testimonialMain = new Swiper(".sa-project-slider", {
		slidesPerView: 3,
		spaceBetween: 0,
		speed: 1500,
		loop: true,
		thumbs: {
			swiper: testimonialNav,
		},
	});

	/*------------------------------------------
	= testimonial slide
	-------------------------------------------*/
	var slider = new Swiper(".sa-testimonial-slider", {
		loop: true,
		spaceBetween: 30,
		speed: 400,
		slidesPerView: 5,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 5,
			},
			'768': {
				slidesPerView: 2,
				centeredSlides: false,
			},
			'576': {
				slidesPerView: 2,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= team slide
	-------------------------------------------*/
	var slider = new Swiper(".team-slider", {
		loop: true,
		spaceBetween: 30,
		speed: 400,
		slidesPerView: 3,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 3,
			},
			'768': {
				slidesPerView: 2,
			},
			'576': {
				slidesPerView: 3,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= industries slide
	-------------------------------------------*/
	var slider = new Swiper(".industries-slider", {
		loop: true,
		spaceBetween: 40,
		speed: 400,
		slidesPerView: 8,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		breakpoints: {
			'1600': {
				slidesPerView: 8,
			},
			'768': {
				slidesPerView: 4,
			},
			'576': {
				slidesPerView: 4,
			},
			'0': {
				slidesPerView: 2,
				spaceBetween: 20,
				centeredSlides: false,
			},
		},
	});

	/*------------------------------------------
	= cs-tes-slider
	-------------------------------------------*/
	var csSlider = new Swiper(".cs-brand-slider", {
		loop: true,
		spaceBetween: 120,
		speed: 600,
		slidesPerView: 5,
		centeredSlides: true,
		clickable: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 5,
			},
			'768': {
				slidesPerView: 1,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});
	var swiper2 = new Swiper(".cs-tes-slider", {
		loop: true,
		slidesPerView: 1,
		clickable: true,
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		thumbs: {
			swiper: csSlider,
		},
	});

	/*------------------------------------------
	= hd-testimonial slide
	-------------------------------------------*/
	var slider = new Swiper(".hd-testimonial-slider", {
		loop: true,
		spaceBetween: 30,
		speed: 400,
		slidesPerView: 3,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		breakpoints: {
			'1600': {
				slidesPerView: 3,
			},
			'768': {
				slidesPerView: 3,
			},
			'576': {
				slidesPerView: 2,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= hd-award slide
	-------------------------------------------*/
	var slider = new Swiper(".hd-award-slider", {
		loop: true,
		spaceBetween: 40,
		speed: 400,
		slidesPerView: 8,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		breakpoints: {
			'1600': {
				slidesPerView: 8,
			},
			'768': {
				slidesPerView: 4,
				spaceBetween: 30,
			},
			'576': {
				slidesPerView: 3,
				spaceBetween: 30,
			},
			'0': {
				slidesPerView: 2,
				spaceBetween: 20,
				centeredSlides: false,
			},
		},
	});

	/*------------------------------------------
	= da-testimonial slide
	-------------------------------------------*/
	var slider = new Swiper(".da-testimonial-slider", {
		loop: true,
		spaceBetween: 30,
		speed: 400,
		slidesPerView: 1,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 1,
			},
			'768': {
				slidesPerView: 1,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= roadmap slide
	-------------------------------------------*/
	var slider = new Swiper(".raodmap-slider", {
		loop: true,
		spaceBetween: 50,
		speed: 400,
		slidesPerView: 3,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 3,
			},
			'1024': {
				slidesPerView: 3,
				spaceBetween: 30,
			},
			'768': {
				slidesPerView: 2,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});
	/*------------------------------------------
	= blog-slider
	-------------------------------------------*/
	var slider = new Swiper(".blog-slider", {
		loop: true,
		spaceBetween: 50,
		speed: 900,
		slidesPerView: 1,
		centeredSlides: true,
		autoplay: {
			enabled: true,
			delay: 6000
		},
		pagination: {
			el: ".swiper-pagination",
			clickable: true,
		},
		navigation: {
			nextEl: ".swiper-button-next",
			prevEl: ".swiper-button-prev",
		},
		breakpoints: {
			'1600': {
				slidesPerView: 1,
			},
			'768': {
				slidesPerView: 1,
			},
			'576': {
				slidesPerView: 1,
			},
			'0': {
				slidesPerView: 1,
			},
		},
	});

	/*------------------------------------------
	= inhover active
	-------------------------------------------*/
	$(".xb-mouseenter").on('mouseenter', function () {
		$(".xb-mouseenter").removeClass("active");
		$(this).addClass("active");
	});
	$(".xb-mouseenter2").on('mouseenter', function () {
		$(".xb-mouseenter2").removeClass("active");
		$(this).addClass("active");
	});

	/*------------------------------------------
	= click button active
	-------------------------------------------*/
	
	/*------------------------------------------
	= click button active
	-------------------------------------------*/
	$(function () {
		$('.sa-tes_button .sa-swiper-btn').on('click', function () {
			var active = $('.sa-tes_button .sa-swiper-btn.active');
			active.removeClass('active');
			$(this).addClass('active');
		});
	});
	/*------------------------------------------
	= click button active
	-------------------------------------------*/
	$(function () {
		$('.brand-items').on('click', function () {
			var active = $('.brand-items.active');
			active.removeClass('active');
			$(this).addClass('active');
		});
	}); 

	/*------------------------------------------
	= click button active
	-------------------------------------------*/
	$(function () {
		$('.team-btn .sa-swiper-btn').on('click', function () {
			var active = $('.team-btn .sa-swiper-btn.active');
			active.removeClass('active');
			$(this).addClass('active');
		});
	}); 

	function setupSlider(sliderId, paginationId) {
		const slider = document.getElementById(sliderId);
		const pagination = document.getElementById(paginationId);
		
		// Initialize your slider and pagination logic here
		// Add event listeners for pagination links
	}
	
	setupSlider('slider1', 'pagination1');
	setupSlider('slider2', 'pagination2');

	/*------------------------------------------
	= magnificPopup
	-------------------------------------------*/
	$('.popup-image').magnificPopup({
		type: 'image',
		gallery: {
			enabled: true
		}
	});
	$('.popup-video').magnificPopup({
		type: 'iframe',
		mainClass: 'mfp-zoom-in',
	});

	/*------------------------------------------
	= Accordion Box
	-------------------------------------------*/
	if ($(".accordion_box").length) {
		$(".accordion_box").on("click", ".acc-btn", function () {
			var outerBox = $(this).parents(".accordion_box");
			var target = $(this).parents(".accordion");

			if ($(this).next(".acc_body").is(":visible")) {
				$(this).removeClass("active");
				$(this).next(".acc_body").slideUp(300);
				$(outerBox).children(".accordion").removeClass("active-block");
			} else {
				$(outerBox).find(".accordion .acc-btn").removeClass("active");
				$(this).addClass("active");
				$(outerBox).children(".accordion").removeClass("active-block");
				$(outerBox).find(".accordion").children(".acc_body").slideUp(300);
				target.addClass("active-block");
				$(this).next(".acc_body").slideDown(300);
			}
		});
	}



	// button hover animation
	$('.xb-hover-btn').on('mouseenter', function (e) {
		var x = e.pageX - $(this).offset().left;
		var y = e.pageY - $(this).offset().top;

		$(this).find('.xb-btn-circle-dot').css({
			top: y,
			left: x
		});
	});

	$('.xb-hover-btn').on('mouseout', function (e) {
		var x = e.pageX - $(this).offset().left;
		var y = e.pageY - $(this).offset().top;

		$(this).find('.xb-btn-circle-dot').css({
			top: y,
			left: x
		});
	});



	// button hover end

	/*------------------------------------------
	= marquee
	-------------------------------------------*/
	$('.marquee-left').marquee({
		speed: 20,
		gap: 0,
		delayBeforeStart: 0,
		direction: 'left',
		duplicated: true,
		pauseOnHover: false,
		startVisible: true,
	  });
	$('.brand-marquee').marquee({
		speed: 50,
		gap: 0,
		delayBeforeStart: 0,
		direction: 'left',
		duplicated: true,
		pauseOnHover: false,
		startVisible: true,
	  });
	$('.marquee-right').marquee({
		speed: 50,
		gap: 0,
		delayBeforeStart: 0,
		direction: 'rihgt',
		duplicated: true,
		pauseOnHover: false,
		startVisible: true,
	});
	$('.cd-marquee-left').marquee({
		speed: 50,
		gap: 0,
		delayBeforeStart: 0,
		direction: 'left',
		duplicated: true,
		pauseOnHover: false,
		startVisible: true,
	});


	// project slider
	$('.seo-project-slider').slick({
		slidesToShow: 1,
		slidesToScroll: 1,
		arrows: false,
		fade: false,
		adaptiveHeight: true,
		centerMode: true,
	   	useTransform: true,
	   	centerPadding: "300px",
		cssEase: 'cubic-bezier(0.77, 0, 0.18, 1)',
		responsive: [{
			breakpoint: 1025,
			settings: {
				centerPadding: "150px",
			}
		}, {
			breakpoint: 640,
			settings: {
				centerPadding: "100px",
		   }
		}, {
			breakpoint: 420,
			settings: {
				centerPadding: "20px",
	   }
		}]
	});
   
	$('.seo-project-slider-nav')
		.on('init', function(event, slick) {
			$('.seo-project-slider-nav .slick-slide.slick-current').addClass('is-active');
		})
		.slick({
			slidesToShow: 4,
			slidesToScroll: 4,
			dots: false,
			arrows: false,
			focusOnSelect: false,
			infinite: true,
			responsive: [{
				breakpoint: 1024,
				settings: {
					slidesToShow: 3,
					slidesToScroll: 3,
				}
			}, {
				breakpoint: 640,
				settings: {
					slidesToShow: 3,
					slidesToScroll: 3,
			   }
			}, {
				breakpoint: 420,
				settings: {
					slidesToShow: 2,
					slidesToScroll: 2,
		   }
			}]
		});
   
	$('.seo-project-slider').on('afterChange', function(event, slick, currentSlide) {
		$('.seo-project-slider-nav').slick('slickGoTo', currentSlide);
		var currrentNavSlideElem = '.seo-project-slider-nav .slick-slide[data-slick-index="' + currentSlide + '"]';
		$('.seo-project-slider-nav .slick-slide.is-active').removeClass('is-active');
		$(currrentNavSlideElem).addClass('is-active');
	});
   
	$('.seo-project-slider-nav').on('click', '.slick-slide', function(event) {
		event.preventDefault();
		var goToSingleSlide = $(this).data('slick-index');
   
		$('.seo-project-slider').slick('slickGoTo', goToSingleSlide);
	});

	// testimonial slider
	$('.cs-testimonial-slider').slick({
		slidesToShow: 1,
		slidesToScroll: 1,
		arrows: true,
		prevArrow:'<button type="button" class="slick-prev"><i class="fal fa-angle-left"></i></button>',
        nextArrow:'<button type="button" class="slick-next"><i class="fal fa-angle-right"></i></button>',
		fade: false,
		adaptiveHeight: true,
	   useTransform: true,
		cssEase: 'cubic-bezier(0.77, 0, 0.18, 1)',
	});
   
	$('.cs-testimonial-slider-nav')
		.on('init', function(event, slick) {
			$('.cs-testimonial-slider-nav .slick-slide.slick-current').addClass('is-active');
		})
		.slick({
			slidesToShow: 5,
			slidesToScroll: 5,
			dots: false,
			arrows: false,
			focusOnSelect: false,
			infinite: true,
			responsive: [{
				breakpoint: 1024,
				settings: {
					slidesToShow: 3,
					slidesToScroll: 3,
				}
			}, {
				breakpoint: 640,
				settings: {
					slidesToShow: 3,
					slidesToScroll: 3,
			   }
			}, {
				breakpoint: 420,
				settings: {
					slidesToShow: 2,
					slidesToScroll: 2,
		   }
			}]
		});
   
	$('.cs-testimonial-slider').on('afterChange', function(event, slick, currentSlide) {
		$('.cs-testimonial-slider-nav').slick('slickGoTo', currentSlide);
		var currrentNavSlideElem = '.cs-testimonial-slider-nav .slick-slide[data-slick-index="' + currentSlide + '"]';
		$('.cs-testimonial-slider-nav .slick-slide.is-active').removeClass('is-active');
		$(currrentNavSlideElem).addClass('is-active');
	});
   
	$('.cs-testimonial-slider-nav').on('click', '.slick-slide', function(event) {
		event.preventDefault();
		var goToSingleSlide = $(this).data('slick-index');
   
		$('.cs-testimonial-slider').slick('slickGoTo', goToSingleSlide);
	});

	// element parallax
	$('.xb-element-parallax').each(function () {
        var $this = $(this);
        var dampingFactor = 0.1;

        function handleMouseMove(e) {
            var offset = $this.offset();
            var mouseX = e.pageX - offset.left;
            var mouseY = e.pageY - offset.top;
            var translateX = (mouseX - $this.width() / 2) * dampingFactor;
            var translateY = (mouseY - $this.height() / 2) * dampingFactor;

            var translateTransform = 'translate(' + translateX + 'px, ' + translateY + 'px)';
            $this.css({
                'transform': translateTransform,
                'transition': 'transform 0.1s ease-out'
            });
        }

        function resetTransform() {
            $this.css({
                'transform': 'none',
                'transition': 'transform 0.1s ease-out'
            });
        }

        if ($this.closest('.xb-parent-element-parallax').length) {
            var pare2 = $this.closest('.xb-parent-element-parallax');
            pare2.mousemove(function (e) {
                handleMouseMove(e);
            });
            pare2.mouseleave(resetTransform);
        } else {
            $this.mousemove(handleMouseMove);
            $this.mouseleave(resetTransform);
        }
    });

})(jQuery);


