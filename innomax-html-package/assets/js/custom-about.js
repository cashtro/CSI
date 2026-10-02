(function($) { "use strict";

	
	//Tooltip
	
	$(".tipped").tipper();	

	
	jQuery(document).ready(function(){
		
		$('.show-after-load').removeClass('show-after-load');

		//Menu accordion
		
		var accordionsMenu = $('.cd-accordion-menu');

		if( accordionsMenu.length > 0 ) {
			
			accordionsMenu.each(function(){
				var accordion = $(this);
				//detect change in the input[type="checkbox"] value
				accordion.on('change', 'input[type="checkbox"]', function(){
					var checkbox = $(this);
					( checkbox.prop('checked') ) ? checkbox.siblings('ul').attr('style', 'display:none;').slideDown(300) : checkbox.siblings('ul').attr('style', 'display:block;').slideUp(300);
				});
			});
		}

	
	/* Scroll Too */
	
		$(".scroll").click(function(event){

			event.preventDefault();

			var full_url = this.href;
			var parts = full_url.split("#");
			var trgt = parts[1];
			var target_offset = $("#"+trgt).offset();
			var target_top = target_offset.top;

			$('html, body').animate({scrollTop:target_top}, 1000);
		});

		
	/* About Carousel */
		
		$("#owl-about").owlCarousel({
			navigation: true,
			pagination : false,
			autoPlay : 6000,
			slideSpeed : 500,
			paginationSpeed : 500,
			singleItem:true
		});	

		/* Logos Carousel */		
		
		$("#owl-logos").owlCarousel({
			items : 6,
			itemsDesktop : [1000,4], 
			itemsDesktopSmall : [900,3],
			itemsTablet: [600,2], 
			itemsMobile : false, 
			pagination : false,
			autoPlay : 3000,
			slideSpeed : 300
		});		
		

		
	});	
 
 
 
 
	
  })(jQuery); 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 





	